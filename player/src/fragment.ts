import { Player } from "./player";

type MessageFragment = {
	segmentID: string;
	chunkID: string;
	chunkNumber: number;
	fragmentNumber: number;
	fragmentTotal: number;
	data: Uint8Array;
};

// this is so moof and mdat is not separated, it is actually 2 chunk, except for styp
type Chunk = {
	isFilled: boolean;
	isStyp: boolean;
	isOther: boolean;
	moof: Uint8Array;
	mdat: Uint8Array;
	styp: Uint8Array;
	other: Uint8Array;
}

export class FragmentedMessageHandler {
	private fragmentBuffers: Map<string, Uint8Array[]>;
	private chunkBuffers: Map<string, Map<number, Chunk>>;
	private nextChunkNumbers: Map<string, number>;
	private segmentStreams: Map<string, ReadableStreamDefaultController<Uint8Array>>;

	constructor() {
		this.fragmentBuffers = new Map();
		this.chunkBuffers = new Map();
		this.nextChunkNumbers = new Map();
		this.segmentStreams = new Map();
	}

	async handleDatagram(datagram: Uint8Array, player: Player) {
		const isSegment = datagram.at(0)
		if (!isSegment) {
			const stream = new ReadableStream({
				start(controller) {
				controller.enqueue(datagram.slice(1));
				controller.close();
				}
			});
			player.handleStream(stream)
		}  
		const fragment = this.parseDatagram(datagram.slice(1));

		if (!this.segmentStreams.has(fragment.segmentID)) {
			// console.log("CREATE ", fragment.segmentID)
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
				this.nextChunkNumbers.set(segmentID, 0);
			},
			cancel: () => {
				this.cleanup(segmentID);
				// console.log("CANCEL", segmentID)
			}
		});
		setTimeout(() => {
			this.cleanup(segmentID);
		}, 3000); 
		player.handleStream(stream);
	}

	private storeFragment(fragment: MessageFragment) {
		if (!this.fragmentBuffers.has(fragment.chunkID)) {
			this.fragmentBuffers.set(fragment.chunkID, new Array(fragment.fragmentTotal).fill(null))
		}
		const fragmentBuffer = this.fragmentBuffers.get(fragment.chunkID);
		if (fragmentBuffer) {
			// if (fragment.chunkNumber !== 70 && fragment.fragmentNumber !== 3)
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
					this.chunkBuffers.set(fragment.segmentID, new Map())
				}
				const chunkBuffers = this.chunkBuffers.get(fragment.segmentID)!;
				
				const boxType = fromCharCodeUint8([...completeData.slice(4, 8)]);

				if (chunkBuffers.has(fragment.chunkNumber)) {
					const chunk = chunkBuffers.get(fragment.chunkNumber)!
					if (boxType == "styp") {
						// this one shouldn't be possible
						chunk.isStyp = true
						chunk.styp = completeData
					} else if (boxType == "moof") {
						chunk.moof = completeData
					} else if (boxType == "mdat") {
						chunk.mdat = completeData
					} else {
						chunk.isOther = true
						chunk.other = completeData
					}
					chunk.isFilled = true
					chunkBuffers.set(fragment.chunkNumber, chunk)
				} else {
					const chunk = { isFilled: false, isStyp: false, isOther: false, moof: new Uint8Array(), mdat: new Uint8Array(), styp: new Uint8Array(), other: new Uint8Array()}
					if (boxType == "styp") {
						chunk.isFilled = true
						chunk.isStyp = true
						chunk.styp = completeData
					} else if (boxType == "moof") {
						chunk.moof = completeData
					} else if (boxType == "mdat") {
						chunk.mdat = completeData
					} else {
						chunk.isFilled = true
						chunk.isOther = true
						chunk.other = completeData
					}
					chunkBuffers.set(fragment.chunkNumber, chunk)
				}

				this.fragmentBuffers.delete(fragment.chunkID);
			}
		}
		let nextNumber = this.nextChunkNumbers.get(fragment.segmentID);
		const controller = this.segmentStreams.get(fragment.segmentID);
		const chunkBuffers = this.chunkBuffers.get(fragment.segmentID);
		if (chunkBuffers !== undefined && nextNumber !== undefined && controller !== undefined) {
			// Skip dropped
			if (chunkBuffers.has(nextNumber+1)) {
				// console.log("SKIP ", nextNumber)
				chunkBuffers.delete(nextNumber)
				nextNumber++
			}
			let data = chunkBuffers.get(nextNumber)
			while (data !== undefined && data.isFilled) {
				
				if (data.isOther) {
					controller.enqueue(data.other)
				}
				else if (data.isStyp) {
					controller.enqueue(data.styp)
				} else {
					controller.enqueue(data.moof)
					controller.enqueue(data.mdat)
				}
				chunkBuffers.delete(nextNumber)
				// if (nextNumber === 0) console.log("MSG INIT ", fragment.segmentID)
				
				nextNumber++
				data = chunkBuffers.get(nextNumber)
			}
			this.nextChunkNumbers.set(fragment.segmentID, nextNumber)
		}
	}

	private flush(segmentID: string) {
		const controller = this.segmentStreams.get(segmentID)
		const buffer = this.chunkBuffers.get(segmentID)
		if (controller != undefined && buffer != undefined) {
			const sortedEntries = Array.from(buffer.entries()).sort((a, b) => a[0] - b[0]);
			// console.log("REMAINDER",segmentID, sortedEntries.length)
			sortedEntries.forEach(entry => {
				// console.log("A!", entry[0], segmentID)
				if (entry[1].isOther) {
					controller.enqueue(entry[1].other)
				}
				else if (entry[1].isStyp) {
					controller.enqueue(entry[1].styp)
				} else {
					controller.enqueue(entry[1].moof)
					controller.enqueue(entry[1].mdat)
				}
			});
		}
	}

	private cleanup(segmentID: string) {
		// this.flush(segmentID);
		this.segmentStreams.get(segmentID)?.close();
		this.segmentStreams.delete(segmentID);
		this.nextChunkNumbers.delete(segmentID);
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

function fromCharCodeUint8(uint8arr: any[]) {
	var arr = [];
	for (var i = 0; i < uint8arr.length; i++) {
		arr[i] = uint8arr[i];
	}
	return String.fromCharCode.apply(null, arr);
}
