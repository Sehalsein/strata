import type { ReactNode } from "react";
import { A, C, Callout, Code, H2, List, P, Path, Step, Steps, Table, UI } from "../kit";

/**
 * One page per add-on. Each starts with the same card (what it adds, whether it needs
 * setting up, whether it needs TorBox), then how to set it up and what Strata does with it.
 */

function Facts({ kind, setup, torbox, site }: { kind: string; setup: string; torbox: string; site: ReactNode }) {
  const rows: [string, ReactNode][] = [
    ["Adds", kind],
    ["Needs setting up", setup],
    ["TorBox key", torbox],
    ["Where", site],
  ];
  return (
    <dl data-md="facts" className="glass my-6 grid grid-cols-1 gap-px overflow-hidden rounded-2xl sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="px-5 py-4">
          <dt className="text-xs font-semibold tracking-wide text-white/45 uppercase">{label}</dt>
          <dd className="mt-1 text-sm leading-6 text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AddToStrata({ last }: { last?: ReactNode }) {
  return (
    <Step title="Add it to Strata">
      <P>
        In <Path items={["Settings", "Add-ons"]} /> press <UI>+ Add add-on</UI>, paste the address and add it. A <C>stremio://</C> link is fine; Strata turns it into <C>https://</C>.
        {last}
      </P>
    </Step>
  );
}

const KEY_TIP = (
  <Callout type="tip" title="Your TorBox key">
    <p>
      Copy it from <A href="https://torbox.app/settings">torbox.app/settings</A> → <UI>API Key</UI>. Paste the whole thing: a key cut short fails quietly, and you'll just see no streams. If you ever make a new
      TorBox key, set the add-on up again and use <UI>Change address…</UI> on it in Strata.
    </p>
  </Callout>
);

export function Torrentio() {
  return (
    <>
      <Facts kind="Streams" setup="Optional" torbox="Optional, recommended" site={<A href="https://torrentio.strem.fun/configure">torrentio.strem.fun/configure</A>} />
      <Callout type="note" title="You may not need it">
        <p>
          Strata's built-in add-on already asks Torrentio (the server's, set under <UI>Strata's Torrentio</UI>) and checks TorBox's cache itself. Add your own Torrentio only if you want its filters — like
          excluding qualities or sorting — on top.
        </p>
      </Callout>
      <Steps>
        <Step title="Open Torrentio's configure page">
          <P>
            Go to <A href="https://torrentio.strem.fun/configure">torrentio.strem.fun/configure</A>.
          </P>
        </Step>
        <Step title="Choose TorBox">
          <P>Pick TorBox as the debrid provider and paste your TorBox API key. Set any providers, qualities or sorting you like.</P>
        </Step>
        <Step title="Copy the install link">
          <P>Copy the link from the install button instead of clicking it. It ends in <C>manifest.json</C> and carries your settings and key.</P>
        </Step>
        <AddToStrata last={<> Then drag it above or below the built-in Strata add-on.</>} />
      </Steps>
      {KEY_TIP}
      <H2>What Strata does with it</H2>
      <List>
        <li>Torrentio's TorBox mark (<C>[TB+]</C>) tells Strata a release is already cached, so it's offered as <UI>Plays now</UI>.</li>
        <li>Its releases are added to your TorBox when you play them, and cleaned up later under the TorBox <UI>Clean up after</UI> setting.</li>
      </List>
    </>
  );
}

export function Comet() {
  return (
    <>
      <Facts kind="Streams" setup="Required — the bare address is refused" torbox="Yes" site={<A href="https://docs.elfhosted.com/stremio-addons/guide/comet-stremio-addon/">ElfHosted's Comet guide</A>} />
      <Steps>
        <Step title="Open a Comet configure page">
          <P>
            ElfHosted runs a free public one at <A href="https://comet.elfhosted.com/configure">comet.elfhosted.com/configure</A>. A self-hosted Comet has its own at <C>/configure</C>.
          </P>
        </Step>
        <Step title="Pick TorBox and paste your key">
          <P>Choose TorBox as the debrid service, paste your API key, and set your filters.</P>
        </Step>
        <Step title="Copy the install link">
          <P>
            Copy it rather than installing. It ends in <C>manifest.json</C>.
          </P>
        </Step>
        <AddToStrata />
      </Steps>
      {KEY_TIP}
      <H2>What Strata does with it</H2>
      <List>
        <li>
          With a debrid service set, Comet hands back direct links. Strata plays these as link-only streams, named after Comet, and lists them in the Library as <UI>Add-on link</UI>.
        </li>
        <li>In torrent mode, Strata reads each release's hash from Comet's labels, so it can add it to your TorBox like any other release.</li>
      </List>
      <Callout type="warning" title="Needs setting up first">
        <p>
          If Strata says <em>Comet needs setting up first</em>, you pasted the address of the site itself. Use the install link from the configure page.
        </p>
      </Callout>
    </>
  );
}

export function MediaFusion() {
  return (
    <>
      <Facts kind="Streams (and some catalogs)" setup="Recommended" torbox="Yes, for cached playback" site={<A href="https://mhdzumair.github.io/MediaFusion/integrations/stremio/">MediaFusion's Stremio docs</A>} />
      <Steps>
        <Step title="Open MediaFusion's configure page">
          <P>
            ElfHosted runs a free public instance at <A href="https://mediafusion.elfhosted.com">mediafusion.elfhosted.com</A>.
          </P>
        </Step>
        <Step title="Add TorBox as a streaming provider">
          <P>Paste your API key, then set stream filters such as resolution, size and seeders.</P>
        </Step>
        <Step title="Copy the install link">
          <P>To change settings later, configure it again and use the new link.</P>
        </Step>
        <AddToStrata />
      </Steps>
      {KEY_TIP}
      <H2>What Strata does with it</H2>
      <List>
        <li>Its streams are ranked with everything else; the higher MediaFusion sits in your list, the more it wins ties.</li>
        <li>
          If its manifest offers movie or series catalogs, you can turn them on as rows in <A href="/addons/pages">Pages</A>.
        </li>
      </List>
    </>
  );
}

export function AioStreams() {
  return (
    <>
      <Facts kind="Streams, from many add-ons at once" setup="Required" torbox="Yes" site={<A href="https://docs.elfhosted.com/stremio-addons/guide/aiostreams-setup/">ElfHosted's AIOStreams guide</A>} />
      <P>AIOStreams asks several add-ons at once and filters, sorts and formats everything into one list. It works best in Strata of any stream add-on, because Strata can ask it for details other add-ons leave out.</P>
      <Steps>
        <Step title="Open an AIOStreams configure page">
          <P>Use a public instance (ElfHosted runs one) or your own. Follow its setup to choose the add-ons it combines.</P>
        </Step>
        <Step title="Add TorBox under services">
          <P>Paste your TorBox API key.</P>
        </Step>
        <Step title="Save with a password">
          <P>
            Choose a password and save. AIOStreams gives you a <UI>UUID</UI>: keep it and the password somewhere safe — you need both to edit the setup later, and they can't be recovered.
          </P>
        </Step>
        <Step title="Copy the install link">
          <P>
            Use <UI>Copy install link</UI>. It looks like this:
          </P>
          <Code>{`https://<instance>/stremio/<uuid>/<password>/manifest.json`}</Code>
        </Step>
        <AddToStrata />
      </Steps>
      {KEY_TIP}
      <H2>What Strata does with it</H2>
      <List>
        <li>
          Strata uses the UUID and password in that link to ask AIOStreams' search API for each release's hash, size, languages, HDR and codec. That's what fills the source filters in{" "}
          <UI>Choose Source</UI> and lets Strata add releases to your TorBox.
        </li>
        <li>If an instance has its search API turned off, Strata falls back to its normal streams.</li>
        <li>AIOStreams' TorBox cache check marks releases as <UI>Plays now</UI>.</li>
      </List>
      <Callout type="warning" title="Use the install link as given">
        <p>Strata only recognises AIOStreams by the <C>/stremio/&lt;uuid&gt;/&lt;password&gt;/manifest.json</C> address. Anyone with it can use your setup, so keep it private.</p>
      </Callout>
    </>
  );
}

export function Jackettio() {
  return (
    <>
      <Facts kind="Streams, from your own Jackett indexers" setup="Required — the bare address is refused" torbox="Yes" site="Your own Jackettio instance" />
      <P>Jackettio searches the indexers in a Jackett you run, and plays through a debrid service. It's for people who already run Jackett.</P>
      <Steps>
        <Step title="Open your Jackettio's configure page">
          <P>Point it at your Jackett and pick the indexers to search.</P>
        </Step>
        <Step title="Choose TorBox and paste your key" />
        <Step title="Copy the install link" />
        <AddToStrata
          last={
            <>
              {" "}
              If Jackettio runs on your home network (a <C>192.168…</C> or <C>localhost</C> address), only the server admin can add it.
            </>
          }
        />
      </Steps>
      {KEY_TIP}
    </>
  );
}

export function OpenSubtitles() {
  return (
    <>
      <Facts kind="Subtitles" setup="No" torbox="No" site="Stremio's official add-on" />
      <Steps>
        <Step title="Add this address to Strata">
          <Code>{`https://opensubtitles-v3.strem.io/manifest.json`}</Code>
          <P>
            <Path items={["Settings", "Add-ons"]} /> → <UI>+ Add add-on</UI>.
          </P>
        </Step>
        <Step title="Choose your languages">
          <P>
            Under <Path items={["Settings", "General"]} /> → <UI>Subtitles</UI>, tick up to 10 languages, in order, and choose when subtitles turn on.
          </P>
        </Step>
      </Steps>
      <H2>What Strata does with it</H2>
      <List>
        <li>As a title starts, Strata asks it for subtitles in your languages and keeps the best 3 per language.</li>
        <li>It has 4 seconds to answer; if it's slow, that title plays with the file's own subtitles.</li>
        <li>
          More in <A href="/addons/subtitles">Subtitles</A>.
        </li>
      </List>
    </>
  );
}

export function Cinemeta() {
  return (
    <>
      <Facts kind="Catalogs: popular and featured movies and series" setup="No" torbox="No" site="Stremio's official add-on" />
      <Steps>
        <Step title="Add this address to Strata">
          <Code>{`https://v3-cinemeta.strem.io/manifest.json`}</Code>
        </Step>
        <Step title="Turn its rows on">
          <P>
            Open <Path items={["Settings", "Pages"]} />, pick Home, Movies or Shows, switch on the Cinemeta rows you want and drag them into place.
          </P>
        </Step>
      </Steps>
      <Callout type="note">
        <p>Catalogs that need something typed in, like search, aren't offered as rows. Each title is matched to TMDB, so it opens Strata's own title page.</p>
      </Callout>
    </>
  );
}

export function AioMetadata() {
  return (
    <>
      <Facts kind="Catalogs from TMDB, TVDB, MAL, AniList, MDBList and more" setup="Yes" torbox="No" site={<A href="https://docs.elfhosted.com/app/aiometadata/">ElfHosted's AIOMetadata docs</A>} />
      <P>AIOMetadata builds catalogs from many sources: trending, top rated, by year or language, anime lists, and your own MDBList and Trakt lists. It's the most flexible way to fill Strata's rows.</P>
      <Steps>
        <Step title="Open AIOMetadata's configure page">
          <P>
            Use a public instance (ElfHosted runs one) or your own, at <C>/configure</C>.
          </P>
        </Step>
        <Step title="Pick and order your catalogs">
          <P>Add the catalogs you want, for movies and series. If you want personal lists, connect MDBList or Trakt under its integrations.</P>
        </Step>
        <Step title="Save and copy the install link" />
        <AddToStrata />
        <Step title="Turn its rows on in Pages">
          <P>
            In <Path items={["Settings", "Pages"]} />, switch on the rows you want. Each page shows up to 12 add-on rows.
          </P>
        </Step>
      </Steps>
      <Callout type="tip" title="Changed your catalogs?">
        <p>
          AIOMetadata's settings live in its link. After editing them, copy the new link and use <UI>Change address…</UI> on it in Strata, then <UI>Refresh</UI>.
        </p>
      </Callout>
      <Callout type="note">
        <p>AIOMetadata can also answer for title details, but Strata always uses TMDB for those. Only its catalogs are used.</p>
      </Callout>
    </>
  );
}

export function MdbList() {
  return (
    <>
      <Facts kind="Catalogs from your MDBList lists" setup="Yes, with your MDBList API key" torbox="No" site={<A href="https://mdblist.com">mdblist.com</A>} />
      <P>
        MDBList lets you build lists — "best sci-fi of the 2010s", "on Netflix and rated over 7" — and keeps them up to date. There isn't one official MDBList add-on; the easiest way in is through a catalog
        add-on that supports it, like AIOMetadata.
      </P>
      <Steps>
        <Step title="Make or follow lists on MDBList">
          <P>Sign in at mdblist.com and build lists, or follow other people's.</P>
        </Step>
        <Step title="Copy your MDBList API key">
          <P>It's in your MDBList account settings.</P>
        </Step>
        <Step title="Connect it in a catalog add-on">
          <P>
            In <A href="/addons/guides/aiometadata">AIOMetadata</A>, connect MDBList with the key and add your lists as catalogs. Save, and copy the install link.
          </P>
        </Step>
        <AddToStrata />
        <Step title="Turn the rows on in Pages" />
      </Steps>
      <Callout type="note">
        <p>Free MDBList accounts have a limit on how many lists you can make.</p>
      </Callout>
    </>
  );
}

/** The directory: every add-on with a guide, at a glance. */
export function Directory() {
  return (
    <>
      <P>
        Step-by-step setup for the add-ons that work well with Strata. They all go in the same way — set up on their own site, copy the install link, paste it into <Path items={["Settings", "Add-ons"]} />{" "}
        — but each has its own quirks. <A href="/addons/install">Install add-ons</A> covers the general idea.
      </P>
      <Table
        head={["Add-on", "Adds", "Needs TorBox"]}
        rows={[
          [<A href="/addons/guides/torrentio">Torrentio</A>, "Streams", "Optional"],
          [<A href="/addons/guides/comet">Comet</A>, "Streams", "Yes"],
          [<A href="/addons/guides/mediafusion">MediaFusion</A>, "Streams", "Yes"],
          [<A href="/addons/guides/aiostreams">AIOStreams</A>, "Streams, combined", "Yes"],
          [<A href="/addons/guides/jackettio">Jackettio</A>, "Streams, self-hosted", "Yes"],
          [<A href="/addons/guides/opensubtitles">OpenSubtitles v3</A>, "Subtitles", "No"],
          [<A href="/addons/guides/cinemeta">Cinemeta</A>, "Catalogs", "No"],
          [<A href="/addons/guides/aiometadata">AIOMetadata</A>, "Catalogs", "No"],
          [<A href="/addons/guides/mdblist">MDBList</A>, "Catalogs from your lists", "No"],
        ]}
      />
      <H2>A good starting set</H2>
      <List ordered>
        <li>
          <UI>AIOStreams</UI> or <UI>Comet</UI>, with your TorBox key, for streams.
        </li>
        <li>
          <UI>OpenSubtitles v3</UI> for subtitles.
        </li>
        <li>
          <UI>AIOMetadata</UI> or <UI>Cinemeta</UI> for extra rows.
        </li>
      </List>
      <P>A household can have up to 10 add-ons, and the built-in Strata add-on is always there too.</P>
      <Callout type="note" title="These are third-party services">
        <p>Add-ons are run by other people, and their pages change. If a step here doesn't match what you see, follow the add-on's own page — the part that matters to Strata is the install link it gives you.</p>
      </Callout>
    </>
  );
}
