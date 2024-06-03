/* globals attachMediaStream, Vue, peers, localMediaStream, dataChannels, signalingSocket */

"use strict";

const searchParams = new URLSearchParams(window.location.search);
let roomId = searchParams.get("room") || generateRoomId();

if (!searchParams.has("room")) {
	searchParams.set("room", roomId);
	window.location.search = searchParams.toString();
}

function generateRoomId() {
	return Math.random().toString(36).substr(2, 6);
}

const App = Vue.createApp({
	data() {
		return {
			peerId: "",
			roomId,
			roomLink: "",
			copyText: "",
			userAgent: "",
			isMobileDevice: false,
			isTablet: false,
			isIpad: false,
			isDesktop: false,
			videoDevices: [],
			audioDevices: [],
			audioEnabled: true,
			videoEnabled: true,
			screenShareEnabled: false,
			showChat: false,
			showSettings: false,
			hideToolbar: true,
			selectedAudioDeviceId: "",
			selectedVideoDeviceId: "",
			name: window.localStorage.name,
			typing: "",
			chats: [],
			callInitiated: false,
			callEnded: false,
		};
	},
	methods: {
		initiateCall() {
			if (!this.roomId) return alert("Invalid room id");
			if (!this.name) return alert("Invalid name");

			this.callInitiated = true;
			window.initiateCall();
		},
		copyURL() {
			navigator.clipboard.writeText(this.roomLink)
				.then(() => {
					this.copyText = "Copied 👍";
					setTimeout(() => (this.copyText = ""), 3000);
				})
				.catch(console.error);
		},
		async toggleMedia(e, type) {
			e.stopPropagation();
			const tracks = type === "audio" ? localMediaStream.getAudioTracks() : localMediaStream.getVideoTracks();

			if (tracks.length > 0) {
				if (type === "audio" ? this.audioEnabled : this.videoEnabled) {
					tracks[0].stop();
					this[type + 'Enabled'] = false;
				} else {
					this[type + 'Enabled'] = true;
					try {
						const constraints = type === "audio" ? { audio: { deviceId: this.selectedAudioDeviceId } } : { video: { deviceId: this.selectedVideoDeviceId } };
						const stream = await navigator.mediaDevices.getUserMedia(constraints);
						const newTrack = type === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
						const newStream = type === "audio" ? new MediaStream([...localMediaStream.getVideoTracks(), newTrack]) : new MediaStream([newTrack, ...localMediaStream.getAudioTracks()]);
						localMediaStream = newStream;
						attachMediaStream(document.getElementById("selfVideo"), newStream);
						for (let peer_id in peers) {
							const sender = peers[peer_id].getSenders().find(s => s.track?.kind === type);
							if (sender) sender.replaceTrack(newTrack);
						}
					} catch (err) {
						console.error(`Error restarting ${type} track: `, err);
					}
				}
			}
			this.updateUserData(type + "Enabled", this[type + 'Enabled']);
		},
		audioToggle(e) {
			this.toggleMedia(e, "audio");
		},
		videoToggle(e) {
			this.toggleMedia(e, "video");
		},
		toggleSelfVideoMirror() {
			document.querySelector("#videos .video #selfVideo").classList.toggle("mirror");
		},
		updateName() {
			window.localStorage.name = this.name;
		},
		updateNameAndPublish() {
			this.updateName();
			this.updateUserData("peerName", this.name);
		},
		async screenShareToggle(e) {
			e.stopPropagation();
			let screenMediaPromise;

			if (!this.screenShareEnabled) {
				screenMediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true });
			} else {
				screenMediaPromise = navigator.mediaDevices.getUserMedia({ video: true });
				document.getElementById(this.peerId + "_videoEnabled").style.visibility = "hidden";
			}

			try {
				const screenStream = await screenMediaPromise;
				this.screenShareEnabled = !this.screenShareEnabled;
				this.videoEnabled = true;
				this.updateUserData("videoEnabled", this.videoEnabled);

				for (let peer_id in peers) {
					const sender = peers[peer_id].getSenders().find(s => s.track?.kind === "video");
					if (sender) sender.replaceTrack(screenStream.getVideoTracks()[0]);
				}

				screenStream.getVideoTracks()[0].enabled = true;
				const newStream = new MediaStream([screenStream.getVideoTracks()[0], localMediaStream.getAudioTracks()[0]]);
				localMediaStream = newStream;
				attachMediaStream(document.getElementById("selfVideo"), newStream);
				this.toggleSelfVideoMirror();

				screenStream.getVideoTracks()[0].onended = () => {
					if (this.screenShareEnabled) this.screenShareToggle();
				};

				if (cabin) cabin.event("screen-share-" + this.screenShareEnabled);
			} catch (err) {
				console.error("Error sharing screen: ", err);
			}
		},
		updateUserData(key, value) {
			this.sendDataMessage(key, value);

			switch (key) {
				case "audioEnabled":
					document.getElementById(this.peerId + "_audioEnabled").className =
						"audioEnabled icon-mic" + (value ? "" : "-off");
					break;
				case "videoEnabled":
					document.getElementById(this.peerId + "_videoEnabled").style.visibility = value ? "hidden" : "visible";
					break;
				case "peerName":
					document.getElementById(this.peerId + "_videoPeerName").innerHTML = value + " (you)";
					break;
				default:
					break;
			}
		},
		async changeDevice(deviceId, type) {
			const constraints = type === "audio" ? { audio: { deviceId } } : { video: { deviceId } };

			try {
				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				this[type + 'Enabled'] = true;
				this.updateUserData(type + "Enabled", this[type + 'Enabled']);

				for (let peer_id in peers) {
					const sender = peers[peer_id].getSenders().find(s => s.track?.kind === type);
					if (sender) sender.replaceTrack(stream.getTracks()[0]);
				}

				const newStream = type === "audio" ? new MediaStream([localMediaStream.getVideoTracks()[0], stream.getAudioTracks()[0]]) : new MediaStream([stream.getVideoTracks()[0], ...localMediaStream.getAudioTracks()]);
				localMediaStream = newStream;
				attachMediaStream(document.getElementById("selfVideo"), newStream);
				if (type === "audio") this.selectedAudioDeviceId = deviceId;
				else this.selectedVideoDeviceId = deviceId;
			} catch (err) {
				console.error(`Error changing ${type} device: `, err);
				alert(`Error while swapping ${type}`);
			}
		},
		changeCamera(deviceId) {
			this.changeDevice(deviceId, "video");
		},
		changeMicrophone(deviceId) {
			this.changeDevice(deviceId, "audio");
		},
		sanitizeString(str) {
			const tagsToReplace = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
			return str.replace(/[&<>]/g, tag => tagsToReplace[tag] || tag);
		},
		linkify(str) {
			return this.sanitizeString(str).replace(/(?:https?|ftp):\/\/[\w/\-?=%.]+\.[\w/\-?=%]+/gi, match => {
				let displayURL = match.trim().replace(/^https?:\/\//, "");
				displayURL = displayURL.length > 25 ? `${displayURL.substr(0, 25)}&hellip;` : displayURL;
				const url = /^https?:\/\//i.test(match) ? match : `http://${match}`;
				return `<a href="${url}" target="_blank" class="link" rel="noopener">${displayURL}</a>`;
			});
		},
		edit(e) {
			this.typing = e.target.textContent;
		},
		paste(e) {
			e.preventDefault();
			const clipboardData = e.clipboardData || window.clipboardData;
			const pastedText = clipboardData.getData("Text").replace(/(\r\n\t|\n|\r\t)/gm, " ");
			document.execCommand("inserttext", false, pastedText);
		},
		sendChat(e) {
			e.preventDefault();
			if (!this.typing.trim()) return;

			if (Object.keys(peers).length > 0) {
				const composeElement = document.getElementById("compose");
				this.sendDataMessage("chat", this.typing);
				this.typing = "";
				composeElement.textContent = "";
				composeElement.blur();
			} else {
				alert("No peers in the room");
			}
		},
		sendDataMessage(key, value) {
			const dataMessage = {
				type: key,
				name: this.name,
				id: this.peerId,
				message: value,
				date: new Date().toISOString(),
			};

			if (key === "chat") {
				this.chats.push(dataMessage);
				this.$nextTick(this.scrollToBottom);
			}

			Object.values(dataChannels).forEach(channel => channel.send(JSON.stringify(dataMessage)));
		},
		handleIncomingDataChannelMessage(dataMessage) {
			const elementId = `${dataMessage.id}_${dataMessage.type}`;
			switch (dataMessage.type) {
				case "chat":
					this.showChat = true;
					this.hideToolbar = false;
					this.chats.push(dataMessage);
					this.$nextTick(this.scrollToBottom);
					break;
				case "audioEnabled":
					document.getElementById(elementId).className = `audioEnabled icon-mic${dataMessage.message ? "" : "-off"}`;
					break;
				case "videoEnabled":
					document.getElementById(elementId).style.visibility = dataMessage.message ? "hidden" : "visible";
					break;
				case "peerName":
					document.getElementById(elementId).innerHTML = dataMessage.message;
					break;
				default:
					break;
			}
		},
		scrollToBottom() {
			const chatContainer = this.$refs.chatContainer;
			chatContainer.scrollTop = chatContainer.scrollHeight;
		},
		formatDate(dateString) {
			const date = new Date(dateString);
			const hours = date.getHours();
			const minutes = date.getMinutes();
			const period = hours >= 12 ? "PM" : "AM";
			const formattedHours = hours % 12 || 12;
			return `${formattedHours}:${minutes.toString().padStart(2, "0")} ${period}`;
		},
		setStyle(key, value) {
			document.documentElement.style.setProperty(key, value);
		},
		onCallFeedback(e) {
			try {
				if (cabin) {
					cabin.event(e.target.getAttribute("data-cabin-event"));
				}
			} catch (error) {
				console.error("Error sending cabin event: ", error);
			}
		},
		exit() {
			signalingSocket.close();
			Object.values(peers).forEach(peer => peer.close());
			this.callEnded = true;
			location.reload();
		},
	},
}).mount("#app");
