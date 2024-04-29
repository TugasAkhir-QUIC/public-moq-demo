	import { Player } from "./player";

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
	private chunkBuffers: Map<string, Map<number, Uint8Array>>;
	private nextChunkNumbers: Map<string, number>;
	private maxChunkNumber: Map<string, number>;
	private segmentStreams: Map<string, ReadableStreamDefaultController<Uint8Array>>;

	constructor() {
		this.fragmentBuffers = new Map();
		this.chunkBuffers = new Map();
		this.nextChunkNumbers = new Map();
		this.segmentStreams = new Map();
		this.maxChunkNumber = new Map();
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
			this.initializeStream(fragment.segmentID, player);
		}

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
			}
		});
		setTimeout(() => {
			this.flush(segmentID);
			this.segmentStreams.get(segmentID)?.close();
			this.cleanup(segmentID);
		}, 2000); 
		player.handleStream(stream);
	}

	private storeFragment(fragment: MessageFragment) {
		if (!this.fragmentBuffers.has(fragment.chunkID)) {
			this.fragmentBuffers.set(fragment.chunkID, new Array(fragment.fragmentTotal).fill(null))
		}
		const fragmentBuffer = this.fragmentBuffers.get(fragment.chunkID);
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
					this.chunkBuffers.set(fragment.segmentID, new Map())
				}
				const chunkBuffers = this.chunkBuffers.get(fragment.segmentID)!;
				chunkBuffers.set(fragment.chunkNumber, completeData)
				
				if (this.maxChunkNumber.has(fragment.segmentID)) {
					const currMaxNumber = this.maxChunkNumber.get(fragment.segmentID)
					if (currMaxNumber! < fragment.chunkNumber) {
						this.maxChunkNumber.set(fragment.segmentID, fragment.chunkNumber)
					}
				} else {
					this.maxChunkNumber.set(fragment.segmentID, fragment.chunkNumber)
				}

				this.fragmentBuffers.delete(fragment.chunkID);

				let nextNumber = this.nextChunkNumbers.get(fragment.segmentID)
				const controller = this.segmentStreams.get(fragment.segmentID)
				if (nextNumber !== undefined && controller !== undefined) {
					while (chunkBuffers.has(nextNumber)) {
						const data = chunkBuffers.get(nextNumber)
						if (data) {
							controller.enqueue(data)
						}
						nextNumber++
					}
				}
				this.nextChunkNumbers.set(fragment.segmentID, nextNumber!)
			}
		}
	}

	private flush(segmentID: string) {
		let nextNumber = this.nextChunkNumbers.get(segmentID)
		const maxNumber = this.maxChunkNumber.get(segmentID)
		const controller = this.segmentStreams.get(segmentID)
		const buffer = this.chunkBuffers.get(segmentID)

		if (nextNumber !== undefined && maxNumber !== undefined && controller !== undefined && buffer !== undefined) {
			while (nextNumber <= maxNumber) {
				console.log("A!", nextNumber, maxNumber)
				const data = buffer.get(nextNumber)
				if (data) {
					controller.enqueue(data)
				}
				nextNumber++
			}
		}
	}

	private cleanup(segmentID: string) {
		this.segmentStreams.delete(segmentID);
		this.nextChunkNumbers.delete(segmentID);
		this.chunkBuffers.delete(segmentID);
		this.maxChunkNumber.delete(segmentID);
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
