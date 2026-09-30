# Local development Postgres: the same major version production will run,
# plus pgTAP and pg_prove for the supabase/tests suite. The official Debian
# image already has the PGDG apt repository configured, so both come from there.
FROM postgres:17.11

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-17-pgtap \
      libtap-parser-sourcehandler-pgtap-perl \
 && rm -rf /var/lib/apt/lists/*
