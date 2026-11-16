import { A, C, Callout, Code, H2, H3, List, P, Path, Step, Steps, Table, UI } from "../kit";

export function AddonsInstall() {
  return (
    <>
      <P>
        Add-ons let Strata find more to play, more subtitles and more rows to browse. They're <UI>Stremio add-ons</UI>: you add one with the same manifest URL you'd install in Stremio. Manage them under{" "}
        <Path items={["Settings", "Add-ons"]} />; changes there save straight away.
      </P>
      <Table
        head={["Kind", "Adds", "For example"]}
        rows={[
          ["Streams", "Releases to play, ranked alongside your own copies", "Torrentio, AIOStreams, Comet, MediaFusion, Jackettio"],
          ["Subtitles", "Subtitles in your languages, fetched as a title starts", "OpenSubtitles v3"],
          ["Catalogs", "Rows for Home, Movies and Shows", "Cinemeta, AIO Metadata, MDBList"],
        ]}
      />

      <H2>The built-in Strata add-on</H2>
      <P>
        Before you add anything, there's already one in the list, marked <UI>Built in</UI>. It bundles Torrentio, TorBox's own search and TorBox's cache check, so with just a TorBox key you can already play
        titles you don't own. You can move it or switch it off, but not edit or remove it.
      </P>
      <P>
        The server admin chooses which Torrentio it uses under <Path items={["Backoffice", "Server settings", "Server"]} /> → <UI>Strata's Torrentio</UI> (default{" "}
        <C>https://torrentio.strem.fun</C>). Leave it empty to use TorBox search only.
      </P>

      <H2>Add an add-on</H2>
      <Steps>
        <Step title="Configure it on its own site first">
          <P>
            Most stream add-ons want to know your debrid service. Open the add-on's <UI>configure</UI> page, choose <UI>TorBox</UI>, paste your TorBox API key, and set the options you like.
          </P>
        </Step>
        <Step title="Copy the manifest URL">
          <P>
            The configure page gives you a link to install. Copy it rather than clicking it. It ends in <C>manifest.json</C>, or starts with <C>stremio://</C> — both are fine.
          </P>
        </Step>
        <Step title="Add it to Strata">
          <P>
            In <Path items={["Settings", "Add-ons"]} /> press <UI>+ Add add-on</UI>, paste the address and add it. Strata checks it right away by asking for a test film.
          </P>
        </Step>
        <Step title="Put it in order">
          <P>
            Drag it where you want it. See <A href="/addons/order">Order, health and sources</A>.
          </P>
        </Step>
      </Steps>
      <Code label="Addresses Strata accepts">{`
https://example-addon.com/abc123/manifest.json
https://example-addon.com/abc123          # /manifest.json is added for you
stremio://example-addon.com/abc123/manifest.json
`}</Code>
      <Callout type="tip" title="Keys live in the address">
        <p>
          A configured add-on's URL contains your settings, often including your TorBox key. Treat it like a password. If you change your TorBox key, reconfigure the add-on and use{" "}
          <UI>Change address…</UI> from its ⋯ menu, which keeps its place and switch.
        </p>
      </Callout>

      <H2>Common setups</H2>
      <Callout type="tip" title="Step-by-step guides">
        <p>
          Each add-on below has its own page in <A href="/addons/guides">Add-on guides</A>, with exactly what to pick on its configure page.
        </p>
      </Callout>
      <H3>Streams with TorBox</H3>
      <P>
        Torrentio, Comet, MediaFusion, AIOStreams and Jackettio all have a configure page with a debrid section. Pick TorBox, paste your key, and copy the manifest. Comet, Jackettio and AIOStreams{" "}
        <em>must</em> be configured; their bare address is refused.
      </P>
      <P>
        Add-ons set up with a debrid service often return direct links. Strata plays those as <UI>link-only streams</UI>, without going through your TorBox library, and lists them in the Library as{" "}
        <UI>Add-on link</UI>.
      </P>
      <H3>Subtitles</H3>
      <P>OpenSubtitles v3 needs no setup:</P>
      <Code>{`https://opensubtitles-v3.strem.io/manifest.json`}</Code>
      <P>
        Then pick your languages: see <A href="/addons/subtitles">Subtitles</A>.
      </P>
      <H3>Catalog rows</H3>
      <P>
        Cinemeta works as is; AIO Metadata and MDBList let you build lists on their configure pages. Once installed, turn their rows on in Pages: see <A href="/addons/pages">Home rows and pages</A>.
      </P>
      <Code>{`https://v3-cinemeta.strem.io/manifest.json`}</Code>

      <H2>When an add-on is refused</H2>
      <Table
        head={["Message", "What to do"]}
        rows={[
          ["… needs setting up first", "Open its configure page, set it up (most want your TorBox key) and paste the manifest URL it gives you."],
          ["That address isn't a Stremio add-on manifest", "Copy the install link from the configure page, not the page's own address."],
          ["… doesn't have movies or shows", "It's for something else, like live TV or music. Strata only uses movies and series."],
          ["Use the address it redirects to", "Open the link in a browser and paste where it lands."],
          ["That add-on is already in the list", "Use Change address… on the existing one instead."],
        ]}
      />
      <List>
        <li>A household can have up to 10 add-ons.</li>
        <li>Addresses with a user name or password in them aren't accepted.</li>
        <li>Add-ons running on your own network (localhost or a LAN address) can only be added by the server admin.</li>
      </List>
    </>
  );
}

export function AddonsOrder() {
  return (
    <>
      <P>Once your add-ons are in, three things decide what plays: their order, whether they're healthy, and the filters people pick in the app.</P>

      <H2>Order</H2>
      <P>
        The list reads <UI>Add-ons, in the order Strata asks them</UI>. Drag a row by its handle, or focus the handle and use <C>Space</C>, the arrow keys, then <C>Space</C>. When two sources are equally
        good, the higher add-on wins.
      </P>
      <P>Your own copies come first: Strata ranks by quality, then prefers this server's disk, then TorBox, then add-on links. An add-on link never outranks a copy you have.</P>
      <P>
        To stop using one without losing its setup, flip its switch off. It shows <UI>Off: Strata doesn't ask it</UI>.
      </P>

      <H2>The health light</H2>
      <Table
        head={["Light", "Means"]}
        rows={[
          ["Green", "It answered recently, with how long ago and how fast."],
          ["Red · Failing", "The last request failed, with the reason in plain words — it didn't answer in time, turned Strata away (401, so set it up again), or asked to slow down (429)."],
          ["Amber · Paused", "Three failures in a row: Strata skips it for 5 minutes, then asks again."],
          ["Grey", "Not asked since the server started, or switched off."],
        ]}
      />
      <P>
        The lights refresh every 30 seconds and reset when the server restarts. <UI>Refresh</UI> at the top re-reads every add-on's manifest; one that fails is kept as it was.
      </P>

      <H2>The ⋯ menu</H2>
      <List>
        <li>
          <UI>Configure</UI>: opens the add-on's own configure page, if it has one.
        </li>
        <li>
          <UI>Change address…</UI>: paste a new manifest URL, keeping its place and switch.
        </li>
        <li>
          <UI>Delete…</UI>: remove it. <UI>Delete all</UI> at the top removes every add-on but the built-in one.
        </li>
      </List>

      <H2>Choosing a source in the app</H2>
      <P>
        In the apps, <UI>Choose Source</UI> lists everything that can play a title, with filters. A filter only shows when it actually tells sources apart, and duplicates from several add-ons are merged into
        one, marked <UI>Also on …</UI>.
      </P>
      <Table
        head={["Filter", "Options"]}
        rows={[
          ["Quality", "4K · 1080p · 720p and lower"],
          ["Availability", "Plays now"],
          ["Picture", "Dolby Vision · HDR · SDR"],
          ["Size", "Under 5 GB · 5–20 GB · Over 20 GB"],
          ["Audio", "Up to 8 languages"],
        ]}
      />

      <H2>Discovery settings</H2>
      <P>
        <Path items={["Settings", "Discovery"]} /> controls finding releases of titles you don't have:
      </P>
      <Table
        head={["Setting", "What it does"]}
        rows={[
          ["Find releases", "Look for releases at all. On by default."],
          ["Show uncached releases", "Include releases TorBox would have to download first. On by default."],
          ["Largest automatic pick", "Cap the size Strata picks by itself: no limit, or 2–80 GB."],
        ]}
      />
      <P>
        And <Path items={["Settings", "Library"]} /> → <UI>Highest quality</UI> caps what's picked at 4K (default), 1080p or 720p.
      </P>
    </>
  );
}

export function AddonsPages() {
  return (
    <>
      <P>
        <Path items={["Settings", "Pages"]} /> sets the rows on each page of the apps — <UI>Home</UI>, <UI>Movies</UI>, <UI>Shows</UI> and <UI>Anime</UI> — for everyone in the household. Rows marked{" "}
        <UI>For each person</UI> are filled for whoever's watching. Changes save immediately.
      </P>

      <H2>Turn on add-on rows</H2>
      <Steps>
        <Step title="Install a catalog add-on">
          <P>
            Any add-on with the <UI>Catalogs</UI> badge. See <A href="/addons/install">Install add-ons</A>.
          </P>
        </Step>
        <Step title="Open Pages and pick a page">
          <P>Its catalogs appear in the list, tagged with the add-on's name. Movies only offers movie catalogs, and Shows only series.</P>
        </Step>
        <Step title="Switch them on and drag them into place">
          <P>
            The counter shows <UI>N of 12 add-on rows</UI>; a page can show up to 12.
          </P>
        </Step>
      </Steps>
      <P>Each title in an add-on row is matched to Strata's own, so it opens the normal title page and plays from your sources. A row takes up to 20 titles, is refreshed hourly, and is skipped for a while if the add-on is slow to answer.</P>

      <H2>Configure a row</H2>
      <P>The gear on a row opens its settings:</P>
      <List>
        <li>
          <UI>Name</UI>: up to 60 characters; <UI>Use original</UI> puts it back.
        </li>
        <li>
          <UI>Titles shown</UI>: 5 to 50, 15 by default. <UI>See all</UI> always shows the full list.
        </li>
      </List>
      <P>
        The carousel is always first and can't be moved. <UI>Because you watched …</UI> rows can't be renamed. <UI>Reset to default</UI> puts a page back as it came.
      </P>

      <H2>Built-in rows</H2>
      <Table
        head={["Page", "Rows"]}
        rows={[
          ["Home", "Featured, Continue Watching, Up Next, My List, Top picks for you, Because you watched …, Latest Episodes, New Movies, Trending Movies, Trending Shows, Trending Anime"],
          ["Movies", "Spotlight, Trending, Top picks for you, Latest Releases, New in Theaters, Popular, Top Rated"],
          ["Shows", "Spotlight, Trending, Top picks for you, Latest Episodes, New Shows, Popular, Top Rated, Coming Soon"],
          ["Anime", "Spotlight, Trending, This Season, Latest Episodes, Airing Now, Popular, Fan Favorites, Recently Finished, Coming Soon"],
        ]}
      />
      <H3>For you</H3>
      <P>
        <UI>Top picks for you</UI> and up to five <UI>Because you watched</UI> rows come from each person's own plays and My List: well-rated recommendations, leaving out anything they've watched, started or
        saved.
      </P>

      <H2>Calendar and Remind Me</H2>
      <P>
        The apps' calendar shows new episodes of shows you follow (on My List or being watched) and films on My List — <UI>In cinemas</UI>, <UI>Out to stream or rent</UI>, <UI>Out on disc</UI> — using the
        household's Region. An entry says <UI>Ready to play</UI> once it can.
      </P>
      <P>
        On a title that isn't out yet, tap <UI>Remind Me</UI>. For shows that means a new season or premiere, not every episode. Reminders are notifications on that device, so allow notifications for
        Strata in the system Settings app.
      </P>
    </>
  );
}

export function AddonsSubtitles() {
  return (
    <>
      <P>
        Subtitles inside your files are always offered. Add a subtitle add-on, like OpenSubtitles v3, and Strata also fetches them from the web as a title starts.
      </P>

      <H2>Set up</H2>
      <Steps>
        <Step title="Add a subtitle add-on">
          <Code>{`https://opensubtitles-v3.strem.io/manifest.json`}</Code>
        </Step>
        <Step title="Pick your languages">
          <P>
            Under <Path items={["Settings", "General"]} /> → <UI>Subtitles</UI>, tick up to 10 <UI>Languages</UI>, in the order you prefer. With none ticked, Strata uses the catalog language.
          </P>
        </Step>
        <Step title="Choose when they turn on">
          <P>
            <UI>Turn on automatically</UI>:
          </P>
          <Table
            head={["Option", "Turns subtitles on"]}
            rows={[
              ["Only for foreign dialogue", "For lines in another language, like a film's subtitled scenes. The default."],
              ["When the audio is foreign", "Whenever the audio isn't in one of your languages."],
              ["Always", "Every time."],
            ]}
          />
        </Step>
      </Steps>

      <H2>How they're fetched</H2>
      <List>
        <li>Add-ons are asked as a title starts, and have 4 seconds to answer; slow ones are left out that time.</li>
        <li>The best 3 per add-on per language are kept, and remembered for 6 hours.</li>
        <li>They're converted to WebVTT, so they work on every device.</li>
      </List>
      <Callout type="note">
        <p>Without any add-ons, subtitles come only from the files themselves.</p>
      </Callout>
    </>
  );
}
