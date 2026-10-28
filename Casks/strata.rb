# brew tap sehalsein/strata https://github.com/Sehalsein/strata
# brew install --cask strata
cask "strata" do
  # Always the current stable Strata.dmg; the app keeps its server up to date after that.
  version :latest
  sha256 :no_check

  url "https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg"
  name "Strata"
  desc "Self-hosted media server for your movies and shows"
  homepage "https://github.com/Sehalsein/strata"

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :sonoma"

  app "Strata.app"

  uninstall quit:       "com.sehalsein.strata.server",
            login_item: "Strata"

  zap trash: [
    "~/Library/Application Support/Strata",
    "~/Library/Preferences/com.sehalsein.strata.server.plist",
  ]
end
