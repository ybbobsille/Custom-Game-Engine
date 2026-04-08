import { WebSocket } from "ws";

const ip = "mainline.proxy.rlwy.net"
const port = 43725
const auth = "eiheiolrxc"

const url = `ws:${ip}:${port}?auth=${auth}`

console.log(url)

const socket = new WebSocket(url)

socket.on("message", console.log)