import {createHash} from "crypto";
import * as WebSocket from "ws";

export type messageListener = (result: any) => void;

interface Command {
	name: string;
	username: string;
	key: string;
	arguments: any[];
	tag: string;
}

interface Subscription {
	name: string;
	username: string;
	key: string;
	show_previous: boolean;
	tag: string;
}

interface Response {
	result: "success" | "error";
	source: string;
	tag: string;
	success?: any;
	error?: any;
	// is_success: boolean;
}

interface Success {
	time: number;
	player: string;
}

interface ChatSuccess extends Success {
	message: string;
	isCancelled: boolean;
}

interface ConnectionSuccess extends Success {
	action: string;
}

export default class Rcon {
	private hostname: string;
	private port: number;

	private username: string;
	private password: string;
	private salt: string;

	private socket: WebSocket;
	private connection: Promise<void>;
	private timer: NodeJS.Timer;

	private commands: {[tag: string]: (value: any) => void} = {};
	private subscriptions: {[tag: string]: boolean} = {};

	private messageListener: messageListener;

	constructor(hostname: string, port: number, username: string, password: string, salt: string, messageListener: messageListener) {
		this.hostname = hostname;
		this.port = port;

		this.username = username;
		this.password = password;
		this.salt = salt;

		this.messageListener = messageListener;

		this.connect().catch(() => {
			//
		});
	}

	public call(method: string, parameters: any[] = []): Promise<any> {
		return this.connect().then(() => {
			const tag = String(Math.random());

			const command: Command = {
				name: method,
				username: this.username,
				key: this.getKey(method),
				arguments: parameters,
				tag,
			};

			this.socket.send("/api/2/call?json=" + JSON.stringify([command]));

			return new Promise((resolve, reject) => {
				this.commands[tag] = (value) => {
					resolve(value);
					delete this.commands[tag];
				};

				setTimeout(() => {
					reject();
					delete this.commands[tag];
				}, 1000);
			});
		});
	}

	public subscribe(source: string, showPrevious: boolean): void {
		this.connect().then(() => {
			const tag = String(Math.random());

			const subscription: Subscription = {
				name: source,
				username: this.username,
				key: this.getKey(source),
				show_previous: showPrevious,
				tag,
			};

			this.subscriptions[tag] = true;

			this.socket.send("/api/2/subscribe?json=" + JSON.stringify([subscription]));
		});
	}

	private getKey(source: string): string {
		return createHash("sha256").update(this.username + source + this.password + this.salt).digest("hex");
	}

	private get url(): string {
		return `ws://${this.hostname}:${this.port}/api/2/websocket`;
	}

	private connect(): Promise<void> {
		clearTimeout(this.timer);

		if (!this.connection) {
			this.connection = new Promise((resolve, reject) => {

				this.socket = new WebSocket(this.url);

				this.socket.addEventListener("open", (event) => {
					resolve();
				});

				this.socket.addEventListener("close", (event) => {
					reject();
					this.connection = null;

					this.timer = setTimeout(() => {
						this.connect().catch(() => {
							//
						});
					}, 5000);
				});

				this.socket.addEventListener("message", (event) => {
					const data: Response | Response[] = JSON.parse(event.data);

					if (Array.isArray(data)) {
						data.forEach((response) => {
							if (this.commands[response.tag]) {
								// TODO: обрабатывать фейлы
								this.commands[response.tag](response.success);
							}
						});
					} else {
						if (this.subscriptions[data.tag]) {
							this.messageListener(data.success);
						}
					}
				});
			});
		}

		return this.connection;
	}
}
