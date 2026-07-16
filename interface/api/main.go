// Command interface-go serves the Labspace interface: a static client bundle
// plus a JSON API for reading content and driving the developer workspace.
//
// It is a Go reimplementation of the Node service in interface-node/api.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/dockersamples/sbxlab/interface/api/internal/analytics"
	"github.com/dockersamples/sbxlab/interface/api/internal/labspace"
	"github.com/dockersamples/sbxlab/interface/api/internal/server"
	"github.com/dockersamples/sbxlab/interface/api/internal/terminal"
	"github.com/dockersamples/sbxlab/interface/api/internal/workspace"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3030"
	}
	publicDir := os.Getenv("PUBLIC_DIR")
	if publicDir == "" {
		exe, err := os.Executable()
		if err != nil {
			log.Fatalf("failed to determine executable path: %v", err)
		}
		publicDir = filepath.Join(filepath.Dir(exe), "public")
	}
	terminalWorkdir := os.Getenv("TERMINAL_WORKDIR")
	if terminalWorkdir == "" {
		terminalWorkdir = "/home/agent/labspace/project"
	}

	lab := labspace.New()
	if err := lab.Bootstrap(); err != nil {
		log.Fatalf("failed to bootstrap labspace: %v", err)
	}
	log.Println("Labspace bootstrapped")

	term := terminal.New(terminalWorkdir)
	ws := workspace.New(lab, term)

	an, err := analytics.New(lab)
	if err != nil {
		log.Fatalf("failed to initialize analytics: %v", err)
	}
	an.PublishStartEvent()

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: server.New(lab, ws, an, term, publicDir).Handler(),
	}

	// Graceful shutdown: on a termination signal, publish the stop event and
	// drain in-flight requests.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	defer stop()

	go func() {
		printBanner(port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	stop()
	log.Println("Received shutdown event")

	an.PublishStopEvent()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("error during shutdown: %v", err)
	}
}

func printBanner(port string) {
	sbxName := os.Getenv("SANDBOX_VM_ID")
	if sbxName == "" {
		sbxName = "<sbx-name>"
	}
	fmt.Printf(`
    ##         .
  ## ## ##    ==
## ## ## ## ===
/"""""""""""""""\___/ ===
{                      /  ===-
 \______ O          __/
  \    \        __/
   \____\_______/

  Lab interface up and running on http://localhost:%s

  To access from your host machine, run:
    sbx ports %s --publish %s:%s

`, port, sbxName, port, port)
}
