/**
 * Returns the livechat room to the given room-id if the current user has the permission.
 * @throws error-not-authorized
 */
function getLiveRoomFromId(rid, errorMethod) {
	if (!Meteor.userId() || !RocketChat.authz.hasPermission(Meteor.userId(), 'view-l-room')) {
		throw new Meteor.Error('error-not-authorized', 'Not authorized', {method: errorMethod});
	}
	const room = RocketChat.models.Rooms.findOneById(rid);
	if (!room) {
		throw new Meteor.Error('error-not-found', 'Not found', {method: errorMethod});
	}
	return room;
}

Meteor.methods({
	/**
	 * @param roomId id of the current livechat room
	 * @return {Room} the livechat room from the previous conversation
	 * @throws Meteor.Error if no room is found
	 */
	'livechat:getPreviousRoom': function (roomId) {
		const room = getLiveRoomFromId(roomId, 'livechat:getPreviousRoom');
		const targetRoom = RocketChat.models.Rooms.findOne({
			"v._id": room.v._id,
			open: {$ne: true}
		}, {sort: {ts: -1}});
		if (!targetRoom) {
			throw new Meteor.Error('error-not-found', 'Not found', {method: 'livechat:getPreviousRoom'});
		}
		return targetRoom;
	},
	/**
	 * Moves all messages from roomToClose to newRoom, increments msg counter on newRoom, removes subscriptions
	 * on roomToClose, deletes roomToClose, reopens newRoom, attaches subscriptions to newRoom
	 * @throws Meteor.Error if rooms cannot be accessed
	 */
	'livechat:mergeRooms': function (roomToCloseId, newRoomId) {
		const closeRoom = getLiveRoomFromId(roomToCloseId, 'livechat:mergeRooms');
		const mergeRoom = getLiveRoomFromId(newRoomId, 'livechat:mergeRooms');

		if (!closeRoom || !mergeRoom) {
			throw new Meteor.Error('error-not-found', 'Not found', {method: 'livechat:mergeRooms'});
		}

		let settings = {answered: false};

		let oldSubscription = RocketChat.models.Subscriptions.findOneByRoomIdAndUserId(roomToCloseId, Meteor.userId());
		if (oldSubscription) {
			if(oldSubscription.answered) {
				settings.answered = oldSubscription.answered;
			}
			if(oldSubscription.lastActivity) {
				settings.lastActivity = oldSubscription.lastActivity;
			}
			if(oldSubscription.lastCustomerActivity) {
				settings.lastCustomerActivity = oldSubscription.lastCustomerActivity;
			}
		}

		if (closeRoom.rbInfo) {
			settings.rbInfo = closeRoom.rbInfo;
		}
		const numOfMsgsToMove = RocketChat.models.Messages.findVisibleByRoomId(roomToCloseId).count();
		RocketChat.models.Messages.updateAllRoomIds(roomToCloseId, newRoomId);
		RocketChat.models.Rooms.incMsgCountAndSetLastMessageTimestampById(newRoomId, numOfMsgsToMove, new Date());

		RocketChat.models.Subscriptions.removeByRoomId(roomToCloseId);
		RocketChat.models.Rooms.removeById(roomToCloseId);
		RocketChat.models.LivechatInquiry.remove({rid: roomToCloseId});
		RocketChat.models.LivechatExternalMessage.remove({rid: roomToCloseId});

		//trigger update for knowledgeAdapter
		Meteor.defer(() => {
			try {
				const lastMsgByVisitorForNewRoom = RocketChat.models.Messages.findLastOneByVisitorForRoom(newRoomId);
				if (_dbs.getKnowledgeAdapter() && lastMsgByVisitorForNewRoom) {
                    _dbs.getKnowledgeAdapter().onMessage(lastMsgByVisitorForNewRoom);
				}
			} catch (e) {
				SystemLogger.error('Error using knowledge provider ->', e);
			}
		});

		RocketChat.models.Rooms.update(newRoomId, {
			$set: {open: true},
			$unset: {comment: '', duration: ''}
		});

		RocketChat.models.Subscriptions.update(
			{rid: newRoomId},
			{$set: settings}
		);

		RocketChat.models.Subscriptions.openByRoomIdAndUserId(newRoomId, Meteor.userId());
	}
});
