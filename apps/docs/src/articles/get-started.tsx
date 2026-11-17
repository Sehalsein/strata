import { A, C, Callout, H2, H3, List, P, Path, Step, Steps, Table, UI } from "../kit";

export function FirstRun() {
  return (
    <>
      <P>
        The first time you open the dashboard, a short wizard walks you through everything. It takes about five minutes, saves its place if you reload, and everything it asks can be changed later in
        Settings.
      </P>
      <Table
        head={["You'll need", "When"]}
        rows={[
          ["A TMDB API key", "Required to browse. See Connections for how to get one."],
          ["Your media", "Optional: you can add folders later."],
          ["A TorBox API key", "Optional."],
          ["The Strata apps", "Later, once the server is ready."],
        ]}
      />

      <H2>The setup code</H2>
      <P>
        To prove you're the one running the server, the wizard asks for a <UI>setup code</UI>. It's 12 characters, like <C>ABCD-EFGH-JKMN</C>, and printed in the server's log every time it starts while no
        account exists.
      </P>
      <List>
        <li>
          <UI>Mac app:</UI> nothing to do: Strata fills it in when you choose <UI>Open Dashboard</UI>.
        </li>
        <li>
          <UI>Linux service:</UI> <C>journalctl --user -u strata-server</C> (or <C>sudo journalctl -u strata-server</C> for a system service), and look for "No account yet".
        </li>
        <li>
          <UI>In a terminal:</UI> it's printed right where you started <C>strata-server</C>.
        </li>
      </List>
      <Callout type="warning">
        <p>After 10 wrong tries from one address in 15 minutes, setup is locked for that address for an hour.</p>
      </Callout>

      <H2>Walking through the wizard</H2>
      <Steps>
        <Step title="Welcome">
          <P>
            A summary of what you'll need. Press <UI>Get started</UI>.
          </P>
        </Step>
        <Step title="Admin account">
          <P>
            Pick a <UI>Username</UI> (defaults to <C>admin</C>), an optional <UI>Email</UI> you can also sign in with, a <UI>Household name</UI>, and a <UI>Password</UI> of at least 8 characters. Paste the{" "}
            <UI>Setup code</UI> and press <UI>Create account</UI>.
          </P>
        </Step>
        <Step title="Services">
          <P>
            Paste your TMDB key and press <UI>Verify &amp; save</UI>. Add TorBox too if you use it. Each has a <UI>How do I get a key?</UI> guide. You can choose <UI>Do it later</UI>, but the catalog stays
            empty until TMDB is connected.
          </P>
        </Step>
        <Step title="Server">
          <P>
            Give the server a <UI>Server name</UI> (it's what the apps show when they find it), pick a <UI>Metadata language</UI>, add your <UI>Media folders</UI>, and decide whether to{" "}
            <UI>Let devices on my home network join without a password</UI>.
          </P>
        </Step>
        <Step title="People">
          <P>
            <UI>Invite someone</UI> now, or <UI>Skip for now</UI>. See <A href="/people/invites">Invite the household</A>.
          </P>
        </Step>
        <Step title="Devices">
          <P>The server's address, with a QR code to scan from your phone.</P>
        </Step>
        <Step title="Finish">
          <P>
            A checklist of what's done. <UI>Open Library</UI> or <UI>Go to Overview</UI> starts the first folder scan.
          </P>
        </Step>
      </Steps>

      <H2>Your household</H2>
      <P>
        Everything you set up — keys, add-ons, folders, pages, people — belongs to a <UI>household</UI>. Most homes only ever need one. The server admin can make more from the switcher at the top of the
        sidebar (<UI>New household</UI>): each has its own library, settings, TorBox key and people.
      </P>
    </>
  );
}

export function Apps() {
  return (
    <>
      <P>
        Get Strata from the <A href="https://apps.apple.com/us/app/strata-tv/id6804102192">App Store</A> for iPhone, iPad and Apple TV. On your home network the app finds the server by itself.
      </P>

      <H2>iPhone and iPad</H2>
      <Steps>
        <Step title="Open Strata">
          <P>
            The <UI>Connect to Strata</UI> screen lists servers <UI>On your network</UI>. If it asks, allow Local Network access, or it can't look for them.
          </P>
        </Step>
        <Step title="Pick your server, or add it by hand">
          <P>
            Tap it in the list. Not there? Type its address (like <C>192.168.1.20</C>), or tap <UI>Scan QR Code</UI> and scan the code from the wizard's Devices step, an invitation or a sign-in code.
          </P>
        </Step>
        <Step title="Sign in">
          <P>
            At home, with the no-password option on, you'll see <UI>Who's watching?</UI> — tap yourself. Otherwise sign in with your <UI>Username or email</UI> and <UI>Password</UI>.
          </P>
        </Step>
      </Steps>

      <H2>Apple TV</H2>
      <P>Typing on a TV is slow, so you don't have to.</P>
      <Table
        head={["Option", "What happens"]}
        rows={[
          ["Pick a server from the list", "The TV shows a code and a QR. Scan it with your phone, or open the dashboard's Link page, and approve. You can choose Use Password Instead."],
          ["Sign In with Your Phone", "The TV shows a QR for an iPhone that's already signed in. The phone finds the TV on the same Wi-Fi, hands it the server and approves it."],
          ["Enter Address", "Type the server's address yourself."],
        ]}
      />
      <P>
        More on approving TVs in <A href="/people/devices">TVs and devices</A>.
      </P>

      <H2>When it doesn't find the server</H2>
      <List>
        <li>Check the phone or TV is on the same network as the server, not a guest Wi-Fi.</li>
        <li>
          On iPhone and iPad, turn Local Network on for Strata in the system <UI>Settings</UI> app.
        </li>
        <li>
          On Linux, install <C>avahi-utils</C>. Check <Path items={["Backoffice", "Server settings", "Network"]} /> for a <UI>Not announcing</UI> badge.
        </li>
        <li>Or skip discovery and type the address.</li>
      </List>
      <H3>"Update needed"</H3>
      <P>The server is older than the app expects. Update the server (see Install the server → Updates).</P>
    </>
  );
}
