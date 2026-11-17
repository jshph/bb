# Recents plugin extraction

The new-thread page's recent-thread list lives in the standalone
[jshph/bb-plugin-recents](https://github.com/jshph/bb-plugin-recents) repository.
Its local checkout sits beside core.
It follows Tandem's one-plugin-per-repository convention and releases
independently of voice. BB's multi-plugin collection manifest is supported,
but these plugins do not share product behavior or release requirements.

Core owns the composer, responsive scrolling layout and homepage slot host.
The plugin owns the list, fifteen-row limit, sorting, hierarchy, collapse
storage, metadata and ancestor reveal. It uses the existing public SDK for
thread data, navigation, provider icons, titles, status, drafts and menus.

The companion SDK 0.6.147 adds two optional homepage fields:

- `experimental_layout: "flush"` lets a section own its heading and spacing.
- `experimental_lastCreatedThreadId` identifies the latest successful creation
  on the mounted home surface. A failed submission does not change it.

Existing homepage sections retain their default heading and spacing. With
Recents disabled, core renders no recent-thread list or background reveal hook.

## Applying the change

Build/deploy this core checkout before enabling Recents. Earlier hosts do not
satisfy the plugin's SDK floor. Install the plugin from its repository or local
checkout using `bb plugin install <source>`. Production deployment remains the
canonical `scripts/deploy-local.sh`; installing a plugin does not deploy core.

The original `bb.mobileRecents.collapsedThreads` browser-storage key is retained
by the plugin. No database migration or daemon protocol change is needed.
`bb recents list --json` uses the same hierarchy and ordering with expanded
parents; browser-local collapse choices and unsent drafts do not appear in
that server-side snapshot.
