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
	//Add Parameter for StatsRef to update stats and throughput map of player.
	private fragmentBuffers: Map<string, Uint8Array[]>;
	private chunkBuffers: Map<string, IQueue<Uint8Array>>;
	private chunkCount: Map<string, number>;
	private chunkTotal: Map<string, number>;
	private isDelayed: Map<string, boolean>;
	private segmentStreams: Map<string, ReadableStreamDefaultController<Uint8Array>>;

	constructor() {
		this.fragmentBuffers = new Map();
		this.chunkBuffers = new Map();
		this.chunkCount = new Map();
		this.chunkTotal = new Map();
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
		
		const buf = await r.bytes(2);
		const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		const segmentID = dv.getUint16(0).toString();
		if (!this.segmentStreams.has(segmentID)) {
			// console.log("STREAM CREATE ", segmentID)
			this.initializeStream(segmentID, player);
		}

		let count = 0
		let moof: Uint8Array = new Uint8Array();
		const controller = this.segmentStreams.get(segmentID)

		setTimeout(() => {
			setInterval(() => {
				const chunkBuffers = this.chunkBuffers.get(segmentID)
				while (chunkBuffers !== undefined && controller !== undefined && chunkBuffers.size() !== 0) {
					this.enqueueChunk(segmentID, chunkBuffers.dequeue(), controller)
				}
			}, 500);
		}, 1600);

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
			
			if (count < 2) { // init & styp
				// controller.enqueue(await r.bytes(size))
				this.enqueueChunk(segmentID, await r.bytes(size), controller)
			} else if (count === 2) {
				moof = await r.bytes(size)
			} else if (count === 3) {
				const mdat = await r.bytes(size)
				const chunk = new Uint8Array(moof.length + mdat.length)
				chunk.set(moof)
				chunk.set(mdat, moof.length)
				// controller.enqueue(chunk)
				this.enqueueChunk(segmentID, chunk, controller)
			}
			count++
		}
	}

	async handleDatagram(datagram: Uint8Array, player: Player) {
		const fragment = this.parseDatagram(datagram);
			
		if (!this.segmentStreams.has(fragment.segmentID)) {
			// console.log("DATAGRAM CREATE ", fragment.segmentID)
			this.initializeStream(fragment.segmentID, player);
		}

		this.storeFragment(fragment);
	}

	private initializeStream(segmentID: string, player: Player) {
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.chunkCount.set(segmentID, 0);
				this.segmentStreams.set(segmentID, controller);
				this.isDelayed.set(segmentID, true);
			},
			cancel: () => {
				this.cleanup(segmentID);
				// console.log("CANCEL", segmentID)
			}
		});
		setTimeout(() => {
			// console.log("CLEANUP", segmentID)
			this.cleanup(segmentID);
		}, 3100); // 4000 (?)
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
						// controller.enqueue(completeData)
						this.enqueueChunk(fragment.segmentID, completeData, controller)
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
					// controller.enqueue(chunkBuffers.dequeue())
					this.enqueueChunk(fragment.segmentID, chunkBuffers.dequeue(), controller)
				}
			}
		}
	}

	private enqueueChunk(segmentID: string, chunk: Uint8Array | undefined, controller: ReadableStreamDefaultController<Uint8Array>) {
		if (chunk === undefined) {
			return
		}
		
		const boxType = fromCharCodeUint8([...chunk.slice(4, 8)]);
		if (boxType === 'finw') {
			const dv = new DataView(chunk.slice(8).buffer, chunk.slice(8).byteOffset, chunk.slice(8).byteLength);
			this.handleFin(dv.getUint16(0).toString(), dv.getUint8(2));
			return
		}

		let count = this.chunkCount.get(segmentID)
		if (count === undefined) {
			return
		}

		count++
		this.chunkCount.set(segmentID, count);
		controller.enqueue(chunk);
		
		if (count === this.chunkTotal.get(segmentID)) {
			this.cleanup(segmentID)
		}
	}

	private handleFin(segmentID: string, chunkTotal: number) {
		const count = this.chunkCount.get(segmentID)
		console.log("CLOSE", segmentID, chunkTotal, count)
		if (chunkTotal === count) {
			this.cleanup(segmentID)
		} else {
			this.chunkTotal.set(segmentID, chunkTotal)
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
		const buf = datagram.slice(0, 7);
		const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		const segmentID = dv.getUint16(0).toString();
		const chunkNumber = dv.getUint8(2);
		const chunkID = segmentID.toString() + "-" + chunkNumber.toString()
		const fragmentNumber = dv.getUint16(3);
		const fragmentTotal = dv.getUint16(5);
		const data = new Uint8Array(datagram.buffer.slice(7));

		return { segmentID, chunkID, chunkNumber, fragmentNumber, fragmentTotal, data };
	}
}

function fromCharCodeUint8(uint8arr: any[]) {
	var arr = [];
	for (var i = 0; i < uint8arr.length; i++) {
		arr[i] = uint8arr[i];
	}
	return String.fromCharCode.apply(null, arr);
}