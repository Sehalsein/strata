import { A, C, Callout, Code, H2, H3, List, P, Path, Step, Steps, Table, UI } from "../kit";

export function Folders() {
  return (
    <>
      <P>Point Strata at the folders your movies and shows live in. It finds every video, works out what it is, and gives it artwork and details from TMDB. Nothing to rename.</P>

      <H2>Add a folder</H2>
      <Steps>
        <Step title="Open the folder settings">
          <P>
            Go to <Path items={["Settings", "Library"]} /> and find <UI>Media folders</UI>.
          </P>
        </Step>
        <Step title="Choose a folder">
          <P>
            Press <UI>Add folder…</UI>. Browse the server's disk, or type a path and press <UI>Go</UI>. Network shares mounted on the server work too.
          </P>
        </Step>
        <Step title="Say what's in it">
          <P>
            Set <UI>Contains</UI> to <UI>Mixed (auto-detect)</UI>, <UI>Movies</UI> or <UI>TV shows</UI>, then <UI>Add this folder</UI>.
          </P>
        </Step>
        <Step title="Save">
          <P>
            Press <UI>Save changes</UI> in the bar at the bottom.
          </P>
        </Step>
      </Steps>
      <Callout type="note">
        <p>Only the server's admin can browse the disk. Removing a folder never touches the files in it.</p>
      </Callout>

      <H2>Scanning</H2>
      <P>
        Folders are scanned every 60 minutes; change it with <UI>Scan folders every</UI> under <Path items={["Backoffice", "Server settings", "Server"]} />. To scan now, press <UI>Run now</UI> next to{" "}
        <UI>Scan local folders</UI> on the Overview.
      </P>

      <H2>Names Strata understands</H2>
      <P>Most layouts just work. These help it get things right first time:</P>
      <Code label="A layout that always works">{`
Movies/
  The Lighthouse Keeper (2021)/
    The Lighthouse Keeper (2021).mkv
Shows/
  Northern Lines/
    Season 02/
      Northern Lines S02E05.mkv
      03 - A Bare Episode Title.mkv
    Specials/
      Northern Lines S00E01.mkv
`}</Code>
      <Table
        head={["Pattern", "Read as"]}
        rows={[
          [<C>S01E02</C>, "Season 1, episode 2. Also S01E02-E03, 1x02 and \"Season 1 Episode 2\"."],
          [<C>Season 2/</C>, "A season folder. Also Series, Staffel, Saison and S2. Specials is season 0."],
          [<C>03 - Title.mkv</C>, "An episode, inside a season folder or a folder set to TV shows."],
          [<C>(2021)</C>, "The year, which helps tell remakes apart."],
          [<C>[Group] Title - 12</C>, "Anime, matched through AniList."],
        ]}
      />
      <H3>What's skipped</H3>
      <List>
        <li>Files with "sample" in the name, and hidden files and folders.</li>
        <li>Folders named extras, featurettes, behind the scenes, deleted scenes or trailers.</li>
        <li>Anything that isn't mkv, mp4, m4v, mov, avi, ts, m2ts, webm, wmv, mpg or mpeg.</li>
      </List>

      <H2>Fix a wrong match</H2>
      <P>
        The <UI>Library</UI> page lists every file Strata knows about, local and TorBox. Use the tabs (<UI>Unmatched</UI>, <UI>Pending</UI>, <UI>Matched</UI>, <UI>Manual</UI>, <UI>Ignored</UI>) to find
        it, then:
      </P>
      <List>
        <li>
          <UI>Fix match</UI>: search TMDB or AniList for the right title, and set the season and episode.
        </li>
        <li>
          <UI>Ignore</UI>: hide a file that isn't a movie or episode. <UI>Restore</UI> brings it back.
        </li>
      </List>
      <P>
        If TMDB isn't connected yet, nothing will match — see <A href="/library/connections">Connections</A>.
      </P>
    </>
  );
}

export function Connections() {
  return (
    <>
      <P>
        Strata uses a few outside services, each with your own key. Add them under <Path items={["Settings", "Connections"]} />. Keys are checked with the service before they're saved, stored encrypted,
        and never shown again. Each household has its own.
      </P>
      <Table
        head={["Service", "What it does"]}
        rows={[
          ["TMDB · required", "The catalog: titles, artwork, cast, and matching your files to them."],
          ["TorBox · optional", "Plays your TorBox library straight from TorBox, and finds releases of titles you don't have."],
          ["OMDb · optional", "IMDb and Rotten Tomatoes ratings on title pages."],
        ]}
      />

      <H2>TMDB</H2>
      <Steps>
        <Step title="Make a free account">
          <P>
            Sign up at <A href="https://www.themoviedb.org/signup">themoviedb.org</A>.
          </P>
        </Step>
        <Step title="Request a key">
          <P>
            Open <A href="https://www.themoviedb.org/settings/api">Settings → API</A>, choose <UI>Developer</UI> under Request an API Key, and fill in the form: personal use, any app name, and{" "}
            <C>http://localhost</C> works as the URL.
          </P>
        </Step>
        <Step title="Paste it into Strata">
          <P>
            On the TMDB card press <UI>Connect</UI>, paste either the <UI>API Key</UI> or the longer <UI>API Read Access Token</UI> — either works — and press <UI>Check &amp; save</UI>.
          </P>
        </Step>
      </Steps>

      <H2>TorBox</H2>
      <Steps>
        <Step title="Copy your API key">
          <P>
            It's at <A href="https://torbox.app/settings">torbox.app/settings</A> under <UI>API Key</UI>.
          </P>
        </Step>
        <Step title="Connect it">
          <P>
            On the TorBox card, paste it and press <UI>Check &amp; save</UI>. A library sync starts straight away, and the card shows your account and plan.
          </P>
        </Step>
      </Steps>
      <Callout type="warning">
        <p>Making a new key on TorBox stops the old one. If you do, paste the new one here (Replace key), and into any add-ons you configured with it.</p>
      </Callout>
      <Table
        head={["Setting", "What it does"]}
        rows={[
          ["Sync every", "How often your TorBox library is read. Off, or 15 minutes (the default) up to a day."],
          ["Clean up after", "Removes releases Strata added that nobody has played, after 14 days by default. What you add yourself is never touched."],
        ]}
      />

      <H2>OMDb</H2>
      <P>
        Get a free key (1,000 requests a day) at <A href="https://www.omdbapi.com/apikey.aspx">omdbapi.com</A>. Click the activation link in the email they send before pasting it, or the check fails.
      </P>

      <H2>Anime</H2>
      <P>AniList and Kitsu are built in, with nothing to set up. They power anime matching, the Anime page, and anime air times on the calendar.</P>
    </>
  );
}
