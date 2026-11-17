import { A, C, Callout, H2, H3, List, P, Step, Steps, Table, UI } from "../kit";

const APP = "https://app.strata.sehalsein.com";
const SIGNUP = `${APP}/signup`;

export function Cloud() {
  return (
    <>
      <P>
        <UI>Strata Cloud</UI> is Strata without a server of your own. Sign up at <A href={SIGNUP}>app.strata.sehalsein.com</A> and you get a household of your own — library, keys, add-ons and people — on a
        server that's already running. Nothing to install, nothing to keep up to date.
      </P>
      <Table
        head={["", "Strata Cloud", "Your own server"]}
        rows={[
          ["Setup", "Sign up in a browser", <A href="/get-started/install">Install the server</A>],
          ["What plays", "TorBox and add-on streams", "Your own files, TorBox and add-ons"],
          ["Media folders", "No", "Yes"],
          ["Away from home", "Works anywhere", "Needs a tunnel or proxy (see Watch away from home)"],
          ["Updates", "Done for you", "Self-updating"],
        ]}
      />
      <Callout type="note" title="No files of your own">
        <p>
          The cloud can't see a hard drive in your house, so it plays only from <A href="/library/connections">TorBox</A> and <A href="/addons/install">stream add-ons</A>. If your library is files on
          a disk, <A href="/get-started/install">run your own server</A> instead.
        </p>
      </Callout>

      <H2>What you need</H2>
      <List>
        <li>An email address you can open, to confirm your account.</li>
        <li>
          A free <A href="https://www.themoviedb.org/settings/api">TMDB API key</A>, for artwork and details. Onboarding asks for it.
        </li>
        <li>
          A <A href="https://torbox.app">TorBox</A> account, so there's something to play. You can add it later.
        </li>
      </List>

      <H2>Create your account</H2>
      <Steps>
        <Step title="Open the sign-up page">
          <P>
            Go to <A href={SIGNUP}>app.strata.sehalsein.com/signup</A>. On the sign-in page, <UI>New to Strata? Create an account</UI> takes you to the same form.
          </P>
        </Step>
        <Step title="Fill in the form">
          <P>
            Enter <UI>Your name</UI>, your <UI>Email</UI>, a <UI>Username</UI> (2–64 letters, numbers, dots, dashes or underscores — you can sign in with it or your email) and a <UI>Password</UI> of at
            least 8 characters. Press <UI>Create account</UI>.
          </P>
          <P>
            Or press <UI>Sign up with Google</UI> to skip the form: there's no password to pick and no email to confirm, and you go straight to onboarding.
          </P>
        </Step>
        <Step title="Confirm your email">
          <P>
            Strata shows <UI>Check your email</UI> and sends a link to the address you gave. Open it: it confirms the address, signs you in and starts onboarding.
          </P>
          <P>
            No email? Check spam. Signing in with your password before you've confirmed sends a fresh link.
          </P>
        </Step>
      </Steps>
      <Callout type="tip" title="Joining someone's household?">
        <p>
          Don't sign up. Open the invitation link they sent you instead: it makes your account inside their household, so you share their library and add-ons. See{" "}
          <A href="/people/invites">Invite the household</A>.
        </p>
      </Callout>

      <H2>Set up your household</H2>
      <P>A short onboarding runs once, right after you sign up. It saves its place if you reload, and everything in it can be changed later in Settings.</P>
      <Steps>
        <Step title="Household">
          <P>
            Your account comes with a household. Give it a <UI>Household name</UI> — it's what the people you invite see — and press <UI>Continue</UI>.
          </P>
        </Step>
        <Step title="Services">
          <P>
            Paste your TMDB key and press <UI>Verify &amp; save</UI>, then add TorBox. Each has a <UI>How do I get a key?</UI> guide, and keys are stored encrypted, for your household only. You can choose{" "}
            <UI>Do it later</UI>, but the catalog stays empty until TMDB is connected. More in <A href="/library/connections">Connect TMDB, TorBox and OMDb</A>.
          </P>
        </Step>
        <Step title="People">
          <P>
            <UI>Invite someone</UI> now, or <UI>Skip for now</UI>. Everyone who watches gets their own account, progress and My List.
          </P>
        </Step>
        <Step title="Devices">
          <P>
            The address to add in the apps, <C>app.strata.sehalsein.com</C>, with a copy button and a QR code to scan from your phone.
          </P>
        </Step>
        <Step title="Finish">
          <P>
            A checklist of what's done. <UI>Go to Overview</UI> or <UI>Open Library</UI> takes you into the dashboard.
          </P>
        </Step>
      </Steps>
      <P>
        Next, add a stream add-on so there's more to play than your TorBox library: <A href="/addons/install">Install add-ons</A>.
      </P>

      <H2>Sign in on your devices</H2>
      <P>
        The cloud isn't on your home network, so the apps won't find it in the list — add it by address. Get Strata from the{" "}
        <A href="https://apps.apple.com/us/app/strata-tv/id6804102192">App Store</A> for iPhone, iPad and Apple TV.
      </P>
      <Table
        head={["Device", "How"]}
        rows={[
          ["iPhone and iPad", <>Type <C>app.strata.sehalsein.com</C> on <UI>Connect to Strata</UI>, or tap <UI>Scan QR Code</UI> and scan the code from onboarding's Devices step. Then sign in.</>],
          ["Apple TV", <>Choose <UI>Sign In with Your Phone</UI> and scan the TV's QR with an iPhone that's already signed in, or <UI>Enter Address</UI> and approve the code it shows.</>],
          ["A browser", <>Everything's at <A href={APP}>app.strata.sehalsein.com</A>.</>],
        ]}
      />
      <P>
        More on approving TVs in <A href="/people/devices">TVs and devices</A>.
      </P>

      <H2>Signing in later</H2>
      <List>
        <li>
          Sign in with your <UI>Username or email</UI> and <UI>Password</UI>, or <UI>Continue with Google</UI> if you signed up with it.
        </li>
        <li>
          <UI>Sign in with a passkey</UI> once you've added one from the account menu's <UI>Sign-in methods</UI> — no password to type.
        </li>
        <li>
          Forgot it? <UI>Forgot password?</UI> under the password field emails you a reset link.
        </li>
      </List>
      <H3>"That Google account isn't connected"</H3>
      <P>
        You made the account with a password, and the same email is on your Google account. Sign in with your password, then connect Google from the account menu's <UI>Sign-in methods</UI>. After that, either works.
      </P>
      <H3>"Too many attempts"</H3>
      <P>Sign-up and sign-in slow down after several tries from one address. Wait a few minutes and try again.</P>
    </>
  );
}
