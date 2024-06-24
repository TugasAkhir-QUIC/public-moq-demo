# WARP as a MOQ Protocol

Warp is a live media transport protocol over QUIC.  Media is split into objects based on the underlying media encoding and transmitted independently over QUIC streams.  QUIC streams are prioritized based on the delivery order, allowing less important objects to be starved or dropped during congestion.

See the [Warp draft](https://datatracker.ietf.org/doc/draft-lcurley-warp/).

# MOQ Testbed

This demo has been forked off the original [WARP demo application code](https://github.com/kixelated/warp).

You can find a working demo [here](https://moq.streaming.university).

There are numerous additions as follows:

- Server-to-client informational messages: Added Common Media Server Data (CMSD, CTA-5006)
keys: Availability Time (at) and Estimated Throughput (ETP).
- Client-to-server control messages
- Passive bandwidth measurements: Sliding Window Moving Average with Threshold (SWMAth) and I-Frame Average (IFA).
- Active bandwidth measurements
- Enhanced user interface

More information and test results have been published in the following paper:

Z. Gurel, T. E. Civelek, A. Bodur, S. Bilgin, D. Yeniceri, and A. C. Begen. Media
over QUIC: Initial testing, findings and results. In ACM MMSys, 2023.


# TA QUIC TEAM Changes to this testbed in purpose of a thesis.
- Datagram Implementation
- Hybrid Implementation
- Switching Implementation

## How To Start in local
### Prequisites and some tips localhost {#prequisites}
- yarn
- ffmpeg
- Go version 1.21
- mkcert
- A video source
- Google Chrome Canary
- This does not work if you use WSL for the server.
- For bash scripts you can use git bash.
### Change launch option in chrome canary
add this argument inside of the Target text box inside of the application properties

`--allow-insecure-localhost --origin-to-force-quic-on=localhost:4443`

why this needs to be done can be seen inside the Chrome section of the `README_warp.md` file inside this repository.

### localhost demo
1. Clone the repository
1. use the video source and then place it inside of /media then run the `generate.sh` bash script, make sure ffmpeg is installed in your computer.
2. Make sure to install `mkcert` to run the generate script in /cert
3. Prepare two terminals
4. Set each terminal to both be in the server and player directory.
5. in the server terminal run `go install` and then `go run main.go`. Make sure to use the certs that you have generated
5. in the player terminal run `yarn install` and then `yarn localtest`
6. Now open chrome canary then head to `https://localhost:1234/?url=https://localhost:4443`
9. Demo can now be played.

## How To Start Deploying Server
### Prequisites
- https://github.com/quic-go/quic-go/wiki/UDP-Buffer-Sizes
- A domain name
- [localhost prequisites](#prequisites)
1. in your linux server clone the repo and also make sure to have all the prequisites to run it.
1. prepare a certificate, in this case we used Let's Encrypt certificates. Make sure to prepare that first 
1. Build the Go project using `go build`
1. use a service manager, in this case we used systemd and then create a service file `sudo nano /etc/systemd/system/myprogram.service`
with its content like so, change as you please
```[Unit]
Description=My Go Program

[Service]
ExecStart=/path/to/deploy/myprogram

[Install]
WantedBy=multi-user.target
```
5. Enable and start your service
```
sudo systemctl enable myprogram.service
sudo systemctl start myprogram.service
```
congrats you have deployed the server.

For the player you can deploy it using caddy or nginx.