# SBX Simulator build. Produces a static `sbx` binary suitable for dropping
# into a Labspaces lab container as a replacement for the real CLI.

BINARY  := sbx
CMD     := ./cmd/sbx
DIST    := dist

# Version is stamped into the binary (main.version). Derived from git; falls
# back to "dev" outside a tagged checkout.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
GOFLAGS := -trimpath

# Static, no libc dependency, so the binary runs in minimal lab containers.
GO      := CGO_ENABLED=0 go

# Cross-compile targets: linux for lab containers, darwin/windows for authors
# testing locally.
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

.PHONY: all build test vet fmt fmt-check check install dist clean version help

all: build ## Build the binary (default)

build: ## Build the static sbx binary into ./sbx
	$(GO) build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o $(BINARY) $(CMD)

test: ## Run the test suite
	go test ./...

vet: ## Run go vet
	go vet ./...

fmt: ## Format the code in place
	gofmt -w .

fmt-check: ## Fail if any file is not gofmt-clean
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "not gofmt-clean:"; echo "$$out"; exit 1; fi

check: build ## Validate every shipped example lab with `sbx --check`
	@rc=0; for lab in testdata/labs/*/sbx-simulator.yaml; do \
	  ./$(BINARY) --check $$lab || rc=1; \
	done; exit $$rc

install: ## Install sbx into $GOBIN (or $GOPATH/bin) with the version stamped
	$(GO) install $(GOFLAGS) -ldflags '$(LDFLAGS)' $(CMD)

dist: clean-dist ## Cross-compile release binaries into ./dist
	@mkdir -p $(DIST)
	@for p in $(PLATFORMS); do \
	  os=$${p%/*}; arch=$${p#*/}; ext=""; \
	  [ "$$os" = "windows" ] && ext=".exe"; \
	  out=$(DIST)/$(BINARY)-$$os-$$arch$$ext; \
	  echo "building $$out"; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o $$out $(CMD) || exit 1; \
	done

version: ## Print the version that would be stamped
	@echo $(VERSION)

clean-dist:
	@rm -rf $(DIST)

clean: clean-dist ## Remove build artifacts
	@rm -f $(BINARY)

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'
