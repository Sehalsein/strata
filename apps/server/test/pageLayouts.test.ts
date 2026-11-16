import { describe, expect, test } from "bun:test";
import { addonRowsOn, applyLayout } from "../src/catalog/pageLayouts";
import type { Shelf } from "../src/catalog/service";

const shelf = (id: string, style?: "hero"): Shelf => ({ id, title: id, kind: "titles", items: [], ...(style ? { style } : {}) });
const ids = (s: Shelf[]) => s.map((x) => x.id);

describe("page layouts", () => {
  const built = [shelf("featured", "hero"), shelf("a"), shelf("because:movie:1"), shelf("because:show:2"), shelf("b"), shelf("new")];

  test("rows that are off go, the rest follow the household's order; rows it doesn't mention yet keep their place after", () => {
    const out = applyLayout(built, [
      { id: "b", on: true },
      { id: "because", on: true },
      { id: "a", on: false },
      { id: "featured", on: true },
    ]);
    // The hero stays first; "because" stands for every "Because you watched" row; "new" isn't in the layout.
    expect(ids(out)).toEqual(["featured", "b", "because:movie:1", "because:show:2", "new"]);
  });

  test("no layout: the page as built", () => {
    expect(ids(applyLayout(built, undefined))).toEqual(ids(built));
  });

  test("add-on rows: the layout's that are on, or the fallback before it's laid out, never more than 12", () => {
    expect(addonRowsOn([{ id: "addon:x:movie/a", on: true }, { id: "addon:x:movie/b", on: false }, { id: "trending", on: true }], ["addon:y:movie/c"])).toEqual(["addon:x:movie/a"]);
    expect(addonRowsOn(undefined, ["addon:y:movie/c"])).toEqual(["addon:y:movie/c"]);
    expect(addonRowsOn(Array.from({ length: 20 }, (_, i) => ({ id: `addon:x:movie/${i}`, on: true })), []).length).toBe(12);
  });
});
