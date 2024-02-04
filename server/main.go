package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/kixelated/invoker"
	"github.com/kixelated/warp-demo/server/internal/warp"
)

func main() {
	err := run(context.Background())
	if err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	addr := flag.String("addr", ":4443", "HTTPS server address")
	cert := flag.String("tls-cert", "../cert/localhost.crt", "TLS certificate file path")
	key := flag.String("tls-key", "../cert/localhost.key", "TLS certificate file path")
	logDir := flag.String("log-dir", "", "logs will be written to the provided directory")

	dash := flag.String("dash", "../media/playlist.mpd", "DASH playlist path")

	flag.Parse()

	media, err := warp.NewMedia(*dash)
	if err != nil {
		return fmt.Errorf("failed to open media: %w", err)
	}

	tlsCert, err := tls.LoadX509KeyPair(*cert, *key)
	if err != nil {
		return fmt.Errorf("failed to load TLS certificate: %w", err)
	}

	config := warp.ServerConfig{
		Addr:   *addr,
		Cert:   &tlsCert,
		LogDir: *logDir,
	}

	//tlsCert, _, _ := generateCert(time.Now(), time.Now().Add(10*24*time.Hour))
	//hash := sha256.Sum256(tlsCert.Raw)
	//fmt.Println(formatByteSlice(hash[:]))
	//tlsCert2 := tls.Certificate{Certificate: [][]byte{tlsCert.Raw}}
	//if err != nil {
	//	return fmt.Errorf("failed to load TLS certificate: %w", err)
	//}
	//
	//config := warp.ServerConfig{
	//	Addr:   *addr,
	//	Cert:   &tlsCert2,
	//	LogDir: *logDir,
	//}

	ws, err := warp.NewServer(config, media)
	if err != nil {
		return fmt.Errorf("failed to create warp server: %w", err)
	}

	log.Printf("listening on %s", *addr)

	return invoker.Run(ctx, invoker.Interrupt, ws.Run)
}

func generateCert(start, end time.Time) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return nil, nil, err
	}
	serial := int64(binary.BigEndian.Uint64(b))
	if serial < 0 {
		serial = -serial
	}
	certTempl := &x509.Certificate{
		SerialNumber:          big.NewInt(serial),
		Subject:               pkix.Name{},
		NotBefore:             start,
		NotAfter:              end,
		IsCA:                  true,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caPrivateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	caBytes, err := x509.CreateCertificate(rand.Reader, certTempl, certTempl, &caPrivateKey.PublicKey, caPrivateKey)
	if err != nil {
		return nil, nil, err
	}
	ca, err := x509.ParseCertificate(caBytes)
	if err != nil {
		return nil, nil, err
	}
	return ca, caPrivateKey, nil
}

func formatByteSlice(b []byte) string {
	s := strings.ReplaceAll(fmt.Sprintf("%#v", b[:]), "[]byte{", "[")
	s = strings.ReplaceAll(s, "}", "]")
	return s
}
