import wrtc from "@roamhq/wrtc";
import { WebSocket } from "ws";

var user_ids = []
var user_connections = {}

class User_Connection {
    uid;
    connected = false;
    open = false;
    pc;
    channel;

    on_close = () => { };
    on_message = () => { }

    async Connect(uid, ws) {
        user_connections[uid] = this
        this.uid = uid
        this.pc = new wrtc.RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        this.channel = this.pc.createDataChannel("data")
        this.channel.onclose = async (e) => {
            user_ids = user_ids.filter(uid => this.uid != uid)
            signal.Remove_User(this.uid)
            await this.on_close(e)
            global.Network_Log(`User ${this.uid} has disconnected!`)
        }
        this.channel.onmessage = async (msg) => {
            await this.on_message(msg)
        }

        var error

        this.pc.oniceconnectionstatechange = () => {
            this.connected = this.pc.iceConnectionState == "completed"

            if (this.connected) {
                global.Network_Log(`Player ${uid} is connected!`)
            }
        }

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    bypass: {
                        RTC: {
                            candidate: event.candidate
                        }
                    },
                    user_id: uid
                }))
            }
        }

        const _message = async (data) => {
            if (this.connected) return
            const msg = JSON.parse(data)

            if (msg.RTC && msg.user_id == uid) {
                if (msg.RTC.answer) {
                    await this.pc.setRemoteDescription(msg.RTC.answer)
                    global.Network_Log(`Answer applied for ${uid}`)
                }
                if (msg.RTC.candidate) {
                    await this.pc.addIceCandidate(msg.RTC.candidate)
                    global.Network_Log(`Added ICE candidate for ${uid}`)
                }
            }
        }

        ws.on("message", _message)

        const offer = await this.pc.createOffer()
        await this.pc.setLocalDescription(offer)

        ws.send(JSON.stringify({
            bypass: {
                room_start: true
            },
            user_id: uid
        }))
        ws.send(JSON.stringify({
            bypass: {
                RTC: {
                    offer: offer
                }
            },
            user_id: uid
        }))

        return await new Promise((resolve, _error) => {
            const check = () => {
                this.open = this.channel.readyState == "open"
                if (this.connected && this.open) {
                    user_ids.push(this.uid)
                    clearInterval(interval)
                    resolve()
                }
            }
            error = _error
            const interval = setInterval(check, 10)
        })
    }

    async Disconnect() {
        this.open = false;
        this.connected = false
    }

    Send(msg) {
        if (this.open && this.connected) {
            this.channel.send(JSON.stringify(msg))
        }
    }
}

class Signal_Handler {
    on_user = () => { }
    Host_Id = null
    Registered = false
    Users = []

    On_Message = async (event) => {
        const msg = JSON.parse(event)

        if (msg.msg) {
            global.Network_Log(msg.msg)
        }
        if (msg.user_joined) {
            const user = new User_Connection()
            await user.Connect(msg.user_joined, this.socket)
            this.Users.push(user)
            this.on_user(user)
        }
        if (msg.host_confirmed) {
            this.Host_Id = msg.host_confirmed
            this.Registered = true
        }
        if (msg.host_denied) {
            this.Registered = msg.host_denied
            this.Disconnect()
        }
    }

    Remove_User(uid) {
        const new_users = []

        for (var user of this.Users) {
            if (user.uid == uid) {
                user.Disconnect()
            }
            else {
                new_users.push(user)
            }
        }

        this.Users = new_users
    }

    Connect() {
        this.socket = new WebSocket(`ws:${global._network_settings.ip
            }:${global._network_settings.port
            }?auth=${global._network_settings.auth
            }`)

        this.socket.on("message", this.On_Message)
        this.socket.on("open", () => {
            this.socket.send(JSON.stringify({
                "register_host": true
            }))
        })

        return new Promise((resolve, error) => {
            const check = () => {
                if (this.Registered == true) {
                    clearInterval(interval)
                    global.Network_Log(`Hosting game with room id: ${this.Host_Id}`)
                    resolve()
                }
                else if (this.Registered != false) {
                    clearInterval(interval)
                    error(this.Registered)
                }
            }
            const interval = setInterval(check, 10)
        })
    }

    async Disconnect() {
        //FIXME: disconnect socket
    }
}

const signal = new Signal_Handler()

global.user_ids = user_ids

export default {
    signal: signal,
    user_ids: user_ids,
    user_connections: user_connections
}