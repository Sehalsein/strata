import { C, Callout, H2, List, P, Step, Steps, UI } from "../kit";

export function Passkeys() {
  return (
    <>
      <P>
        A passkey signs you in to the Strata dashboard with Face ID, Touch ID, Windows Hello or your phone, without typing a password. Your password keeps working, and the private key never leaves your
        device.
      </P>

      <H2>Add a passkey</H2>
      <Steps>
        <Step title="Open Sign-in methods">
          <P>
            Sign in to the dashboard with your password, open the account menu (top right) and choose <UI>Sign-in methods</UI>.
          </P>
        </Step>
        <Step title="Name it and add it">
          <P>
            Type a name you'll recognise, like <C>MacBook</C> or <C>iPhone</C>, and press <UI>Add passkey</UI>. Your browser asks to save it: confirm with Face ID, Touch ID or your device's PIN. Saved in iCloud
            Keychain or Google Password Manager, it's on your other devices too.
          </P>
        </Step>
      </Steps>
      <P>
        Rename a passkey with the pencil, or remove it with the bin. Removing it here stops it signing in. Delete it from your device's password manager too.
      </P>

      <H2>Sign in with it</H2>
      <P>
        On the sign-in page, press <UI>Sign in with a passkey</UI>. Or click the username field: browsers that support it offer your passkey right there. To sign in on a computer that doesn't have the
        passkey, choose the option to use a phone, and scan the QR code with a phone that has it.
      </P>

      <H2>Where passkeys work</H2>
      <P>Browsers only allow passkeys at a secure address with a name, and each passkey belongs to the address it was made at:</P>
      <List>
        <li>
          <strong>In the cloud</strong>, at the server's HTTPS address.
        </li>
        <li>
          <strong>On a home server with an HTTPS address</strong>, at that address (for example behind a reverse proxy or Tailscale). Set <C>STRATA_PUBLIC_URL</C> to it, like{" "}
          <C>https://strata.example.com</C>, and restart the server.
        </li>
        <li>
          <strong>On a home server without one</strong>, only at <C>http://localhost:8420</C> on the computer the server runs on.
        </li>
      </List>
      <P>
        Opened at an IP address like <C>http://192.168.1.20:8420</C>, or at another address than the server's, the dashboard says passkeys can't be used there and where to open it instead.
      </P>
      <Callout type="warning" title="Keep the address stable">
        <p>
          Passkeys stop working if the server's address moves to another domain, including setting <C>STRATA_PUBLIC_URL</C> for the first time on a home server. Set the address before adding passkeys, and
          if you might move between subdomains, set <C>STRATA_PASSKEY_RP_ID</C> to the parent domain first.
        </p>
      </Callout>
    </>
  );
}
