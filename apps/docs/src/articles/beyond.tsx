import { A, C, Callout, Code, H2, H3, List, P, Path, Table, UI } from "../kit";

export function Remote() {
  return (
    <>
      <P>
        Strata has no remote-access switch of its own. To watch away from home, give the server an address you can reach from outside — a tunnel (like Tailscale or Cloudflare Tunnel), or a reverse proxy
        with a port forward — and type that address in the app.
      </P>

      <H2>Before you open it up</H2>
      <List>
        <li>
          Turn off <UI>No password at home</UI> under <Path items={["Backoffice", "Server settings", "Network"]} />.
        </li>
        <li>Use HTTPS. The apps warn about plain HTTP addresses.</li>
        <li>Give every account a strong password.</li>
      </List>

      <H2>Behind a reverse proxy</H2>
      <List>
        <li>A proxy on the same machine as the server is always safe: those connections never count as the home network.</li>
        <li>
          A proxy on <em>another</em> machine must send <C>X-Forwarded-For</C>. Caddy and Traefik do by default. If yours can't, turn No password at home off.
        </li>
        <li>
          Set <C>STRATA_TRUST_PROXY=1</C> so rate limits count the visitor's address rather than the proxy's.
        </li>
      </List>
      <Code label="nginx">{`
location / {
  proxy_pass http://127.0.0.1:8420;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
}
`}</Code>
      <Code label="Caddyfile">{`
strata.example.com {
  reverse_proxy 127.0.0.1:8420
}
`}</Code>

      <H2>Running Strata in the cloud</H2>
      <P>
        The same server also runs in the cloud, on Docker or Cloudflare Workers with a Postgres database. It's a different shape: no local folders, so everything plays from TorBox and add-on links, straight
        to the apps. To use the hosted one rather than run your own, see <A href="/get-started/cloud">Sign up for Strata Cloud</A>.
      </P>
      <Table
        head={["", "At home", "In the cloud"]}
        rows={[
          ["Your files", "Yes", "No — TorBox and add-ons only"],
          ["Sign-up", "By invitation", "Anyone; each account gets its own household"],
          ["Admins", "The setup account", <>Listed in <C>STRATA_ADMIN_EMAILS</C></>],
          ["Discovery, no password at home", "Yes", "No"],
          ["Updates", "Self-updating", "Redeploy"],
        ]}
      />
      <P>
        The Docker image needs <C>DATABASE_URL</C> and <C>STRATA_SECRET_KEY</C>. Keep the secret key the same across deploys, or every stored key has to be entered again. Full instructions are in{" "}
        <A href="https://github.com/Sehalsein/strata/tree/main/deploy/cloud">deploy/cloud</A> and <A href="https://github.com/Sehalsein/strata/tree/main/deploy/cloudflare">deploy/cloudflare</A>.
      </P>
    </>
  );
}

export function SettingsReference() {
  return (
    <>
      <P>Settings come in two groups: the household's, for owners and admins, and the server's, for the server admin in the Backoffice.</P>

      <H2>Household settings</H2>
      <Table
        head={["Section", "What's there"]}
        rows={[
          ["General", "Catalog Language (en-US) and Region (US; drives release dates and age ratings). Subtitle languages and when they turn on."],
          ["Library", "Media folders. Sources & quality → Highest quality: 4K, 1080p or 720p."],
          ["Discovery", "Find releases, Show uncached releases, Largest automatic pick."],
          ["Add-ons", "Stream, subtitle and catalog add-ons, their order and health."],
          ["Pages", "The rows on Home, Movies, Shows and Anime."],
          ["Connections", "TMDB, TorBox (with sync and clean-up) and OMDb keys."],
        ]}
      />
      <P>
        Most sections collect changes in a bar at the bottom: <UI>Save changes</UI> or <UI>Discard</UI>. Add-ons and Pages save as you go.
      </P>

      <H2>Server settings</H2>
      <Table
        head={["Section", "What's there"]}
        rows={[
          ["Server", "Server name; Scan folders every (60 min); Strata's Torrentio; Hardware acceleration (on) and how many transcodes At the same time (3)."],
          ["Network", "The server's addresses (read-only), Bonjour discovery, No password at home."],
          ["Updates", "Channel (stable or nightly), Install automatically, Feed address."],
        ]}
      />
      <Callout type="note">
        <p>
          Port and listening address aren't in Settings on purpose. Set them with <C>--port</C> and <C>--host</C> (or <C>STRATA_PORT</C> and <C>STRATA_HOST</C>), so nothing in the dashboard can lock you out.
        </p>
      </Callout>

      <H2>Usage limits</H2>
      <P>To keep services happy, each household gets up to 300 release searches an hour and 60 TorBox adds a day.</P>
    </>
  );
}

export function Troubleshooting() {
  return (
    <>
      <H2>The catalog is empty</H2>
      <P>
        TMDB isn't connected. Add a key under <Path items={["Settings", "Connections"]} />.
      </P>

      <H2>A file isn't showing up</H2>
      <List>
        <li>
          Wait for the next scan, or press <UI>Run now</UI> next to Scan local folders on the Overview.
        </li>
        <li>
          Check the Library page's <UI>Unmatched</UI> and <UI>Ignored</UI> tabs, and use <UI>Fix match</UI>.
        </li>
        <li>Make sure it isn't in an "extras" or "trailers" folder, or named "sample".</li>
      </List>

      <H2>An add-on shows red</H2>
      <Table
        head={["Reason", "Fix"]}
        rows={[
          ["Turned Strata away (401)", "Its setup has expired or your TorBox key changed. Reconfigure it and use Change address…."],
          ["Asked to slow down (429)", "Public instances get busy. Wait, or move a different add-on above it."],
          ["Didn't answer in time", "The add-on is slow or down. It's paused after 3 failures and retried in 5 minutes."],
        ]}
      />

      <H2>"The add-on's link didn't answer in time"</H2>
      <P>
        A link-only stream failed to start. Try again, or pick another source in <UI>Choose Source</UI>.
      </P>

      <H2>The apps can't find the server</H2>
      <P>
        See <A href="/get-started/apps">Connect the apps</A>. On Linux, check <C>avahi-utils</C> is installed; the Network settings show <UI>Not announcing</UI> if discovery isn't working.
      </P>

      <H2>Setup asks for a code I don't have</H2>
      <P>It's in the server's log, printed at every start until the first account exists. Restart the server to see it again.</P>
      <Code label="Linux">{`
journalctl --user -u strata-server | grep -i "setup code"
sudo journalctl -u strata-server | grep -i "setup code"   # system service
`}</Code>

      <H2>Where the logs are</H2>
      <Table
        head={["Where", "Logs"]}
        rows={[
          ["Dashboard", <>Backoffice → Logs</>],
          ["Mac", <C>~/Library/Application Support/Strata/logs/strata.log</C>],
          ["Linux service", <C>journalctl --user -u strata-server</C>],
        ]}
      />
      <H3>More detail</H3>
      <P>
        Start the server with <C>STRATA_DEBUG=1</C> for debug logging, including the ffmpeg command lines.
      </P>
    </>
  );
}
