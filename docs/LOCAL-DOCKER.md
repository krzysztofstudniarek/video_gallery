# Local Docker without Docker Desktop

The 13 November 2026 setup uses Colima with Apple's Virtualization framework and the Docker
runtime on this Apple Silicon Mac. Docker Desktop does not need to run.

Installed with Homebrew: `colima`, its `lima` dependency, `docker-compose`, `docker-buildx` and
`docker-credential-helper`. The existing standalone Homebrew `docker` client is used.

The default Colima profile has two CPUs, 4 GiB RAM and a 20 GiB data disk. Virtual disks grow on
demand. This setup occupies approximately 1.1 GiB before Supabase images and databases are pulled.
Docker Desktop's existing containers/data were not deleted or migrated.

## Shell configuration

The marked Colima block in `~/.zshrc` exports the local Colima socket as `DOCKER_HOST` and defines
`docker()` to invoke `/opt/homebrew/bin/docker`. This avoids the existing `/usr/local/bin/docker`
symlink into Docker Desktop. Open a new terminal or run `source ~/.zshrc` to load it.

For scripts that do not read `.zshrc`, set:

```sh
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
```

Docker's `colima` context is selected. `~/.docker/config.json` points to the standalone macOS
Keychain credential helper and Homebrew plugin directory. The Compose/Buildx symlinks also point
to Homebrew. Previous configuration and shell/plugin information were backed up under
`~/.docker/backup-before-colima-20261113-124755/`; treat the backup as private configuration.

## Start, check and stop

First ensure there is enough free disk space for the images/database. At the end of setup the
system was nearly full, so Colima was stopped after successful verification. Do not pull the
Supabase stack until at least 10 GiB of working space is available; more is preferable.

```sh
colima start
docker version
docker compose version
docker buildx version
docker run --rm hello-world
# When finished:
colima stop
```

Verified during setup: Docker client 27.3.1 reached Colima's Docker server 29.5.2, Compose 5.6.1
and Buildx 0.38.1 were available, and the ARM64 hello-world container passed. No automatic login
service was enabled. Existing Docker Desktop data/configuration backups remain available.

From the repository's `mvp/` directory, `npm start`, local resets and database tests use Colima
when `DOCKER_HOST` is set. These commands must target disposable local data only. Never use the
shared hosted project for reset/fixture tests.

To use another Docker engine later, remove/review the marked shell block and unset `DOCKER_HOST`
before changing contexts; an explicit host overrides context selection. Review backups before
restoring them so later shell or registry configuration changes are preserved.

Official references: [Colima installation](https://colima.run/docs/installation/) and
[Supabase local runtimes](https://supabase.com/docs/guides/local-development/cli/getting-started).

## Database validation resumed — 17 November 2026

The owner freed disk space; approximately 23 GiB was available at restart. Colima successfully
started the disposable Supabase database/Auth/REST/Edge stack. Empty-database migrations, all 329
SQL checks, schema type generation/drift, real local Auth/Edge integration and the browser suites
passed. Approximately 17 GiB remained after pulling images and running checks. These are point-in-time
observations. The disposable Supabase services were stopped after validation; downloaded images
remain cached for the next local run. No hosted Supabase data was modified.
