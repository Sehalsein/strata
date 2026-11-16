import { A, C, Callout, H2, H3, List, P, Path, Step, Steps, Table, UI } from "../kit";

export function Invites() {
  return (
    <>
      <P>
        Everyone gets their own account, with their own Continue Watching, My List and recommendations. Invite them from <UI>Members</UI> in the dashboard. Strata doesn't send email: you get a link and a QR
        code to pass on.
      </P>

      <H2>Invite someone</H2>
      <Steps>
        <Step title="Open Members and press Invite">
          <P>
            Enter their <UI>Email</UI> and pick a <UI>Role</UI> (Member by default), then <UI>Create invitation</UI>.
          </P>
        </Step>
        <Step title="Share the QR code or link">
          <P>
            Pointing an iPhone or iPad camera at the QR code opens the Strata app straight onto the invitation. Or copy the link and send it however you like. It works for a week, for that email only.
          </P>
        </Step>
        <Step title="They join in the app">
          <P>
            They choose a username and password and tap <UI>Create Account and Join</UI>. If they already have an account it's <UI>Sign In and Join</UI>.
          </P>
        </Step>
      </Steps>
      <P>
        Pending invitations stay listed under Members with <UI>QR code</UI>, <UI>Copy link</UI> and <UI>Cancel</UI>, and when they expire.
      </P>
      <Callout type="tip" title="The QR code works from anywhere in the house">
        <p>It carries an address phones on your network can reach, even if you made the invite on the server itself at localhost.</p>
      </Callout>

      <H2>Roles</H2>
      <Table
        head={["Role", "Can"]}
        rows={[
          ["Owner", "Run the household, including its other owners."],
          ["Admin", "Manage the library, settings and members."],
          ["Member", "Watch. Can't change anything, and uses the apps rather than the dashboard."],
        ]}
      />
      <P>Only an owner can invite another owner, and no one can change their own role. A household holds up to 50 people.</P>

      <H2>Managing people</H2>
      <P>The ⋯ menu next to a person:</P>
      <List>
        <li>
          <UI>Rename</UI>, <UI>Reset password…</UI>, <UI>Download their data</UI>.
        </li>
        <li>
          <UI>Sign-in code</UI>: a QR that signs an iPhone or iPad straight in as them, watch-only. Each code works once and a new one appears every 30 seconds. Handy for a child's iPad.
        </li>
        <li>
          <UI>Remove from household</UI> keeps their account; <UI>Delete account…</UI> removes it everywhere, for good.
        </li>
      </List>
    </>
  );
}

export function Kids() {
  return (
    <>
      <P>
        Each person has a <UI>Can watch</UI> limit and a <UI>Kids</UI> switch, both in the Members list. Titles above the limit don't appear anywhere in the apps for them: not in rows, search or the
        calendar.
      </P>

      <H2>Content limits</H2>
      <Table
        head={["Can watch", "Shows"]}
        rows={[
          ["Everything", "No limit."],
          ["Up to PG-13 / TV-14", "Teens."],
          ["Up to PG / TV-PG", "Kids."],
          ["Up to G / TV-Y7", "Little kids: G, TV-Y, TV-Y7 and TV-G."],
        ]}
      />
      <P>
        Ratings come from TMDB for the household's <UI>Region</UI> (<Path items={["Settings", "General"]} />). An unrated title only shows under a limit if it's family, kids or animation; a rating Strata
        doesn't recognise is treated as adult.
      </P>

      <H2>The Kids switch</H2>
      <P>
        Marks the person as a kid: they get a Kids badge and a Kids tile in the app's <UI>Who's watching?</UI>. Turning it on also sets the limit to <UI>Up to PG / TV-PG</UI>, unless you pick another at the
        same time.
      </P>
      <Callout type="note">
        <p>Add-on posters are only shown to people with no limit; everyone else sees TMDB's artwork for those titles.</p>
      </Callout>
    </>
  );
}

export function Devices() {
  return (
    <>
      <P>Every app, TV and browser that's signed in is listed under <UI>Devices</UI>, with who it belongs to, its network, its access and when it was last used. Press <UI>Sign out</UI> on any of them.</P>

      <H2>Sign in an Apple TV</H2>
      <P>Pick the server on the TV and it shows a code and a QR code. Approve it any of these ways:</P>
      <Steps>
        <Step title="With your iPhone">
          <P>
            Scan the QR code with the camera, or open Strata's settings → <UI>Sign In on a TV</UI> and scan or type the code.
          </P>
        </Step>
        <Step title="From the dashboard">
          <P>
            Open <C>/link</C> on your server (or the <UI>Link a TV</UI> card on the Overview), enter the <UI>Code on the TV</UI>, check it matches, and press <UI>Approve</UI>.
          </P>
        </Step>
      </Steps>
      <P>
        The TV signs in as whoever approved it, watch-only, and appears under Devices. Codes last 10 minutes. Any member can approve a TV, not just admins.
      </P>
      <H3>Sign In with Your Phone</H3>
      <P>
        On the TV's Connect screen, <UI>Sign In with Your Phone</UI> shows a QR for an iPhone that's already signed in. The phone finds the TV on the same Wi-Fi, hands it the server and approves it — nothing to
        type at all.
      </P>

      <H2>No password at home</H2>
      <P>
        With <UI>No password at home</UI> on (under <Path items={["Backoffice", "Server settings", "Network"]} />, on by default), a device that connects straight from your home network sees{" "}
        <UI>Who's watching?</UI> and can just tap a person. Those sign-ins are watch-only.
      </P>
      <Callout type="warning">
        <p>
          Turn it off before you make the server reachable from outside your home, and see <A href="/beyond/remote">Watch away from home</A> if you use a reverse proxy.
        </p>
      </Callout>

      <H2>Profiles on one device</H2>
      <P>A device can hold up to 8 sign-ins, so a family TV can switch between everyone from Who's watching?.</P>
    </>
  );
}
