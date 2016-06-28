/**
 * Api-Extension for Reisebuddy
 */
const RB_API = new Restivus({
	apiPath: 'reisebuddy-api/',
	useDefaultAuth: true,
	prettyJson: true
});

RB_API.addRoute('incoming/:service', {
	/**
	 * Creates a message based on the service provided by the url. Based on the service, there may be a basicAuth
	 * @see rocketchat-livechat\server\api.js
	 * @return {*} statusCode 40x on error or  200 + recived timestamp as json body
	 */
	post() {
		const service = _dbs.getCommunicationService(this.urlParams.service);
		if (!service) {
			return {statusCode: 404};
		}
		if (!service.verifyAuthentification(this.request.headers['authorization'])) {
			return {statusCode: 401};
		}
		let message;
		try {
			message = service.parse(this.bodyParams);
		} catch (e) {
			SystemLogger.warn("rejected malformed request");
			return {statusCode: 401};
		}

		let visitor = RocketChat.models.Users.findOneByUsername(message.from);
		let sendStub = {
			message: {
				_id: Random.id(),
				msg: message.body
			},
			roomInfo: {
				rbInfo: {
					source: service.getRoomType(message.from),
					visitorSendInfo: message.from,
					serviceName: service.getServiceName()
				}
			}
		};
		if (visitor) {
			const rooms = RocketChat.models.Rooms.findOpenByVisitorToken(visitor.profile.token).fetch();
			if (rooms && rooms.length > 0) {
				sendStub.message.rid = rooms[0]._id;
			} else {
				sendStub.message.rid = Random.id();
			}
			sendStub.message.token = visitor.profile.token;
		} else {
			sendStub.message.rid = Random.id();
			sendStub.message.token = Random.id();

			let userId = RocketChat.Livechat.registerGuest({
				username: message.from,
				token: sendStub.message.token
			});
			visitor = RocketChat.models.Users.findOneById(userId);
		}
		sendStub.guest = visitor;
		RocketChat.Livechat.sendMessage(sendStub);
		return {
			statusCode: 200,
			body: {received: new Date().getTime()}
		};
	}
});