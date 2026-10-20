import { describe, expect, test } from "bun:test";
import { certificationAge, UNRECOGNISED } from "../src/catalog/contentRating";

describe("certification ages", () => {
  test("US film and TV ratings", () => {
    expect(certificationAge("PG-13", "US")).toBe(13);
    expect(certificationAge("R", "US")).toBe(17);
    expect(certificationAge("TV-Y7", "US")).toBe(7);
    expect(certificationAge("TV-MA", "US")).toBe(17);
  });
  test("UK ratings and age-number countries", () => {
    expect(certificationAge("12A", "GB")).toBe(12);
    expect(certificationAge("U", "GB")).toBe(0);
    expect(certificationAge("FSK 16", "DE")).toBe(16);
    expect(certificationAge("16+", "RU")).toBe(16);
  });
  test("unrated gives no age; unrecognised ratings count as adult", () => {
    expect(certificationAge("", "US")).toBeNull();
    expect(certificationAge("NR", "US")).toBeNull();
    expect(certificationAge("Banned", "US")).toBe(UNRECOGNISED);
    expect(certificationAge("Caution", "GB")).toBe(UNRECOGNISED);
    expect(certificationAge("Restricted to 18 and over in cinemas only", "US")).toBe(UNRECOGNISED);
    expect(certificationAge("M", "AU")).toBe(15);
    expect(certificationAge("AO", "US")).toBe(UNRECOGNISED); // a games rating, not film: hidden
  });

  test("letter ratings only count for their own country", () => {
    expect(certificationAge("C", "MX")).toBe(18);
    expect(certificationAge("A", "IN")).toBe(18);
    expect(certificationAge("A", "MX")).toBe(0);
    // A bare letter outside its country is unknown, so it's hidden rather than guessed.
    for (const letter of ["C", "P", "E", "A", "M"]) expect(certificationAge(letter, "ZZ")).toBe(UNRECOGNISED);
  });
});
