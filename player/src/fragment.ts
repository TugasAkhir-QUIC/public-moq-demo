import { Player } from "./player";
import { IQueue, Queue } from "./queue";
import { StreamReader, StreamWriter } from "./stream"

type MessageFragment = {
	segmentID: string;
	chunkID: string;
	chunkNumber: number;
	fragmentNumber: number;
	fragmentTotal: number;
	data: Uint8Array;
};

export class FragmentedMessageHandler {
	private fragmentBuffers: Map<string, Uint8Array[]>;
	private chunkBuffers: Map<string, IQueue<Uint8Array>>;
	private isDelayed: Map<string, boolean>;
	private segmentStreams: Map<string, ReadableStreamDefaultController<Uint8Array>>;

	constructor() {
		this.fragmentBuffers = new Map();
		this.chunkBuffers = new Map();
		this.isDelayed = new Map();
		this.segmentStreams = new Map();
	}

	// warp, styp, moof & mdat (I-frame)
	async handleStream(r: StreamReader, player: Player) {
		console.log("Masuk handleStream Fragment")
		const isHybrid = Boolean((await r.bytes(1)).at(0))
		if (!isHybrid) {
			// console.log("stream masuk 2")
			player.handleStream(r)
			return
		}
		
		const segmentID = new TextDecoder('utf-8').decode(await r.bytes(8));
		if (!this.segmentStreams.has(segmentID)) {
			// console.log("STREAM CREATE ", segmentID)
			this.initializeStream(segmentID, player);
		}

		let count = 0
		let moof: Uint8Array = new Uint8Array();
		const controller = this.segmentStreams.get(segmentID)
		while (controller !== undefined) {
			if (count === 4) { // 1 or 4
				this.isDelayed.set(segmentID, false)
			}
			if (await r.done()) {
				console.log('end of stream')
				break;
			}

			const raw = await r.peek(4)
			const size = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0)
			
			if (count < 2) {
				controller.enqueue(await r.bytes(size))
			} else if (count === 2) {
				moof = await r.bytes(size)
			} else if (count === 3) {
				const mdat = await r.bytes(size)
				const chunk = new Uint8Array(moof.length + mdat.length)
				chunk.set(moof)
				chunk.set(mdat, moof.length)
				controller.enqueue(chunk)
			}
			count++
		}
	}

	async handleDatagram(datagram: Uint8Array, player: Player) {
		const isSegment = Boolean(datagram.at(0))
		if (!isSegment) {
			const stream = new ReadableStream({
				start(controller) {
				controller.enqueue(datagram.slice(1));
				controller.close();
				}
			});
			let r = new StreamReader(stream.getReader())
			player.handleStream(r)
			return
		}  
		const fragment = this.parseDatagram(datagram.slice(1));

		if (!this.segmentStreams.has(fragment.segmentID)) {
			// console.log("DATAGRAM CREATE ", fragment.segmentID)
			this.initializeStream(fragment.segmentID, player);
		}

		// if (fragment.isLastChunk) {
		// 	this.cleanup(fragment.segmentID);
		// 	return
		// }

		this.storeFragment(fragment);
	}

	private initializeStream(segmentID: string, player: Player) {
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.segmentStreams.set(segmentID, controller);
				this.isDelayed.set(segmentID, true);
			},
			cancel: () => {
				this.cleanup(segmentID);
				// console.log("CANCEL", segmentID)
			}
		});
		setTimeout(() => {
			this.cleanup(segmentID);
		}, 2100); // 3000 (?)
		let r = new StreamReader(stream.getReader())
		player.handleStream(r);
	}

	private storeFragment(fragment: MessageFragment) {
		if (!this.fragmentBuffers.has(fragment.chunkID)) {
			this.fragmentBuffers.set(fragment.chunkID, new Array(fragment.fragmentTotal).fill(null))
		}
		const fragmentBuffer = this.fragmentBuffers.get(fragment.chunkID);
		const isDelayed = this.isDelayed.get(fragment.segmentID);
		const controller = this.segmentStreams.get(fragment.segmentID);
		if (fragmentBuffer) {
			// if (fragment.chunkNumber === 30 && fragment.fragmentNumber !== 3)
			fragmentBuffer[fragment.fragmentNumber] = fragment.data;
			if (fragmentBuffer.every(element => element !== null)) {
				const totalLength = fragmentBuffer.reduce((acc, val) => acc + val.length, 0);
				const completeData = new Uint8Array(totalLength);

				// Copy each Uint8Array into completeData
				let offset = 0;
				fragmentBuffer.forEach((chunk) => {
					completeData.set(chunk, offset);
					offset += chunk.length;
				});

				if (!this.chunkBuffers.has(fragment.segmentID)) {
					this.chunkBuffers.set(fragment.segmentID, new Queue())
				}
				const chunkBuffers = this.chunkBuffers.get(fragment.segmentID)
				if (isDelayed !== undefined && controller !== undefined && chunkBuffers !== undefined) {
					if (fragment.chunkNumber === 0) {
						controller.enqueue(completeData)
						this.isDelayed.set(fragment.segmentID, false)
					} else {
						chunkBuffers.enqueue(completeData)
					}
				}

				this.fragmentBuffers.delete(fragment.chunkID);
			}
		}
		const chunkBuffers = this.chunkBuffers.get(fragment.segmentID)
		if (isDelayed !== undefined && controller !== undefined && chunkBuffers !== undefined) {
			if (!isDelayed) {
				while (chunkBuffers.size() !== 0) {
					controller.enqueue(chunkBuffers.dequeue())
				}
			}
		}
	}

	private cleanup(segmentID: string) {
		this.segmentStreams.get(segmentID)?.close();
		this.segmentStreams.delete(segmentID);
		this.isDelayed.delete(segmentID);
		this.chunkBuffers.delete(segmentID);
		// console.log("DELETE ", segmentID)
	}

	private parseDatagram(datagram: Uint8Array): MessageFragment {
		const utf8Decoder = new TextDecoder("utf-8");
		const segmentID = utf8Decoder.decode(datagram.slice(0, 8));
		const chunkID = utf8Decoder.decode(datagram.slice(8, 16));
		const buf = datagram.slice(16, 22);
		const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		const chunkNumber = dv.getUint16(0);
		const fragmentNumber = dv.getUint16(2);
		const fragmentTotal = dv.getUint16(4);
		const data = new Uint8Array(datagram.buffer.slice(22));

		return { segmentID, chunkID, chunkNumber, fragmentNumber, fragmentTotal, data };
	}
}