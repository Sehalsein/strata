import { A, C, Callout, Code, H2, H3, List, P, Path, Step, Steps, Table, UI } from "../kit";

const DMG = "https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg";
const RELEASES = "https://github.com/Sehalsein/strata/releases";

export function Install() {
  return (
    <>
      <P>
        Strata has two halves: the <UI>server</UI>, which runs at home next to your files, and the <UI>apps</UI> on iPhone, iPad, Mac and Apple TV, which play from it. Start with the server. It's one
        program with the dashboard, the database and ffmpeg built in, so there's nothing else to install.
      </P>

      <H2>What you need</H2>
      <List>
        <li>
          A Mac with Apple silicon on macOS 14 or later, <em>or</em> a Linux machine (x64 or arm64).
        </li>
        <li>Your movies and shows on that machine, or on a drive or share it can read.</li>
        <li>
          A free <A href="https://www.themoviedb.org/settings/api">TMDB API key</A>. Strata uses it for artwork and details; you'll enter it during setup.
        </li>
      </List>

      <H2>Mac</H2>
      <Steps>
        <Step title="Download Strata.dmg">
          <P>
            Get it from <A href={DMG}>the latest stable release</A>, open it and drag <UI>Strata</UI> to Applications.
          </P>
        </Step>
        <Step title="Open Strata">
          <P>It runs from the menu bar, starts at login, sets up ffmpeg and keeps itself up to date.</P>
        </Step>
        <Step title="Open the dashboard">
          <P>
            Choose <UI>Open Dashboard</UI> in the menu bar, or go to <C>http://localhost:8420</C>. The first visit runs setup, and the Mac app fills in the setup code for you. Carry on with{" "}
            <A href="/get-started/first-run">First-run setup</A>.
          </P>
        </Step>
      </Steps>

      <H3>Or with Homebrew</H3>
      <Code label="Terminal">{`
brew tap sehalsein/strata https://github.com/Sehalsein/strata
brew trust sehalsein/strata   # Homebrew asks before loading casks from other taps
brew install --cask strata
`}</Code>

      <H2>Linux</H2>
      <P>A single binary that installs itself as a service. Pick the file for your machine, make it executable, and install the service.</P>
      <Code label="Terminal">{`
curl -fLo strata-server https://github.com/Sehalsein/strata/releases/download/server-stable/strata-server-linux-x64
chmod +x strata-server
sudo ./strata-server service install --system
`}</Code>
      <Table
        head={["File", "Machine"]}
        rows={[
          [<C>strata-server-linux-x64</C>, "Linux, Intel or AMD"],
          [<C>strata-server-linux-arm64</C>, "Linux, ARM (Raspberry Pi 4/5, Ampere, …)"],
          [<C>strata-server-darwin-arm64</C>, "A Mac, without the menu bar app"],
        ]}
      />
      <P>
        Then open <C>http://&lt;server&gt;:8420</C> from any browser on your network to run setup. ffmpeg is set up on first start.
      </P>
      <Callout type="tip" title="Let the apps find it">
        <p>
          On Linux, install Avahi so iPhone, iPad and Apple TV discover the server by themselves: <C>sudo apt install avahi-utils</C>.
        </p>
      </Callout>
      <Callout type="note" title="User or system service">
        <p>
          <C>--system</C> runs it for the whole machine (data in <C>/var/lib/strata</C>). Without it, it's a user service, which stops when you log out unless you run{" "}
          <C>sudo loginctl enable-linger $USER</C>.
        </p>
      </Callout>

      <H2>Managing the service</H2>
      <Code label="Terminal">{`
strata-server service status
strata-server service restart
strata-server service uninstall   # keeps your data and the binary
`}</Code>
      <Table
        head={["Option", "Env", "Default"]}
        rows={[
          [<C>--port</C>, <C>STRATA_PORT</C>, <C>8420</C>],
          [<C>--host</C>, <C>STRATA_HOST</C>, <C>0.0.0.0</C>],
          [<C>--data-dir</C>, <C>STRATA_DATA_DIR</C>, "~/Library/Application Support/Strata on a Mac, ~/.local/share/strata on Linux"],
          [<C>--database-url</C>, <C>DATABASE_URL</C>, "The database bundled in the data folder"],
        ]}
      />
      <P>
        Port and address are set only here, never in the dashboard, so a settings change can't lock you out. Pass them to <C>service install</C> to make them stick.
      </P>

      <H2>Updates</H2>
      <P>
        The server checks for updates every 6 hours. Choose <UI>stable</UI> or <UI>nightly</UI> under <Path items={["Backoffice", "Server settings", "Updates"]} />, and turn on <UI>Install updates automatically</UI> if you'd
        like it hands-off; otherwise the dashboard shows <UI>Update available</UI> with an <UI>Update</UI> button. An update waits until nothing is playing, backs up the database first, and rolls itself back
        if the new version won't start.
      </P>
      <Code label="Terminal">{`
strata-server update --check   # just look
strata-server update           # install now
`}</Code>
      <P>
        Every download is listed with a <C>SHA256SUMS</C> file on the <A href={RELEASES}>releases page</A>.
      </P>
    </>
  );
}
