# RFC: A lifecycle for malleable extensions

Status: Discussion

## Summary

bb should support the full life of a customization: from one person's request,
through an agent-built implementation and communal reuse, to a better extension
point in the shared product.

Today, plugins and forks are separate paths. A plugin stays within capabilities
bb already exposes. A fork can change anything but must continually absorb
upstream changes. When a request moves from one path to the other, its intent is
usually trapped in code and must be rediscovered.

This RFC proposes making that movement explicit. Every non-trivial extension
should preserve what experience it is trying to create, how it is currently
implemented, where it exceeds the public API, and how we know it still works.
Agents can then build and migrate implementations. Communities can share and
refine them. Maintainers can see repeated gaps and move common engineering into
the base without adopting every local preference.

The central idea is:

> A customization should be able to begin as a local experiment, become a
> shared extension, and eventually teach the base where to become more
> malleable.

## Why the current boundary is not enough

bb already has a capable plugin system. Plugins can contribute UI, commands,
tools, instructions, providers, background services, and host-local behavior.
The problem is not that plugins are weak overall. It is that any fixed API has
edges.

A plugin may build an entire side panel but be unable to add one field to an
existing row. It may add controls around the prompt box but not change one of
its native properties. At that edge, an author can approximate the request,
query the DOM through a content script, ask for a new API, or fork bb.

Those are reasonable implementation choices, but they do not form a coherent
system. A content script does not tell maintainers which missing capability
forced it to query a selector. A fork records which files changed but not which
parts of the resulting experience matter. A feature request records a wish but
not whether several working extensions have already discovered the same
underlying mechanism.

Agents make it cheap to produce more of these local implementations. Without a
way to preserve their intent and feed their lessons back into bb, they may also
produce more invisible coupling and more forks that nobody can safely update.

## The proposed lifecycle

The proposal is a workflow, not a new universal API:

```text
local request
    ↓
reviewable intent and behavioral examples
    ↓
implementation against the current bb capabilities
    ↓
personal, team, or community variations
    ↓
repeated gaps reveal a missing shared mechanism
    ↓
bb adds a stable capability and extensions migrate onto it
```

### 1. Preserve the request

A person should be able to begin in ordinary language. An agent turns the
request into a short, reviewable record containing:

- the experience being requested;
- examples of behavior that must remain true;
- important safety or privacy constraints; and
- preferences that may change without breaking the feature.

This is the extension's **intent**, or spec. It might initially be Markdown.
The goal is not to invent a language before we have examples. The goal is to
separate what the person cares about from how one version of bb happens to
implement it.

### 2. Make the API boundary visible

Before writing code, the agent maps each requirement to current capabilities:

```text
Supported directly       Add an action beside each message
Supported with tradeoff  Replace the whole thread list to change one row
Fragile workaround       Find the native row with a DOM selector
Unsupported              Change core thread scheduling policy
```

The person can then choose the least invasive acceptable path. Requirements
that do not fit the API stay visible rather than being silently dropped or
hidden inside a workaround.

### 3. Implement at the lowest necessary level

Most requests should remain ordinary plugins. A low-level content script can be
an explicit experimental adapter when no semantic UI hook exists. A request
that truly needs core behavior can use a narrowly scoped overlay: a named patch
linked to the requirement and its behavioral checks.

An overlay is still a fork technically. The difference is that it represents
one replaceable implementation of one need, not a permanent new identity for
the whole product. An agent should never create or deploy one silently; it
requires clear authority and a verification plan.

### 4. Let people share and vary it

Malleability should not mean that every individual programs alone. The useful
middle is communal:

```text
bb maintainers
    ↓
plugin authors, company power users, and community maintainers
    ↓
teams and ordinary users
    ↓
personal last-mile preferences
```

A company expert might maintain an incident-response setup for the whole
organization. A community author might maintain a research workflow. Most
people install those versions and change only a few preferences.

Several implementations may satisfy the same intent: one for mobile, one for
an older bb release, and one with a company's audit requirements. They need not
share identical code. Shared behavioral examples make them recognizable as
variations of the same experience.

### 5. Move repeated mechanism into the base

bb can learn from implementations that repeatedly touch the same internal
surface, depend on the same fragile workaround, preserve similar behavior, or
conflict in the same place. These clusters are evidence of a missing extension
capability.

The base should not absorb each final customization. It should absorb the
difficult common engineering—lifecycle, data flow, accessibility, performance,
mobile behavior, composition, and rollback—while extensions retain their
names, policies, appearance, and organizational choices.

> Move common mechanism down into the base. Keep differing policy and taste
> above it.

Once the base exposes the mechanism, agents can migrate existing variations
off selectors and overlays. The extension boundary has moved outward, creating
a safer new area for further customization.

## Three examples

### A small missing UI seam

A user wants project health beside every native thread row. The current choices
might be to replace the entire thread list, append DOM elements from a content
script, or patch the native row.

If several extensions want badges, costs, ownership, or review state in that
same location, bb should not add every badge. It should consider a stable
thread-row decoration capability. Core owns layout, keyboard behavior, and
mobile rendering; extensions provide the meaning and content.

### A communal workflow

A company's incident lead wants bb to open an incident workspace, enable
diagnostic tools, restrict production-changing actions, retain an audit trail,
and show a visible warning state. The lead maintains the shared version; teams
add their own runbooks and alert sources; individual responders only select the
incident.

This is the communal middle: most engineering and policy come from someone
between bb's maintainers and the final user. The extension must carry
provenance, permissions, behavioral promises, and organization-specific
variation—not merely code in a marketplace.

### A request beyond the API

A user wants a clear switch between working in the current project and asking
an agent to modify bb itself. The context should look different, use different
instructions and tools, and route into a separate conversation. Some pieces fit
the plugin API; native prompt behavior or routing may not.

This "Work on bb" example is useful because it crosses the boundary. It can
begin as a plugin plus a workaround, temporarily require a small overlay, and
later migrate to shared prompt-context or routing capabilities. The mode itself
does not need to become a core bb feature.

## The role of specs and agents

The spec is not the runtime API. bb should not repeatedly reinterpret a prompt
to decide what an installed extension does. Natural language is an authoring
interface; activation should use deterministic code, declared effects, and
checks that people can inspect.

The durable extension record should eventually include:

- intent and behavioral examples;
- implementation and supported bb versions;
- public capabilities used;
- fragile dependencies and unmet capabilities;
- affected data and product surfaces;
- permissions, provenance, and conflicts; and
- executable conformance checks.

This changes the role of stability. A TypeScript API compiling is useful, but
it does not prove that an extension still preserves a draft, routes data to the
right place, or composes with another extension. The spec, implementation, and
base should be versioned separately. An agent can replace the implementation
and run the same behavioral checks against the replacement.

Agents do not remove the need for stable APIs. They make implementation code
cheaper to regenerate, which lets us place more of the long-term stability
burden on semantic capabilities, explicit intent, and observable behavior.

## Lower-hanging fruit

We should not start with automatic fork management, a declarative runtime, or
a universal spec schema. The first useful version can work with today's plugin
system:

1. Select three real customizations: an ordinary plugin, a content-script
   workaround, and a maintained local fork.
2. Add a short intent document and three to five behavioral examples to each.
3. Have an agent produce the same capability report for each: direct API use,
   tradeoffs, fragile dependencies, and unsupported requirements.
4. Keep the behavioral checks with the implementation and use them during one
   bb upgrade.
5. Compare the three reports for a repeated missing semantic seam.
6. Add one narrow `experimental_` capability and migrate the relevant
   implementation onto it.

This tests the whole feedback loop without first changing plugin loading or
distribution. If the records do not help an agent perform the upgrade or help
maintainers identify a better capability, the proposal has failed cheaply.

A later phase could add machine-readable capability declarations, an
agent-facing planning command, explicit workaround warnings, organization-level
extension policy, and managed overlays. Those features should be designed from
the evidence produced by the first experiment.

## What this proposal is not

This RFC does not replace typed APIs with prompts, expose every React component
as public API, automatically merge arbitrary forks, or turn popular personal
preferences into core features. It proposes that plugins, workarounds, and
forks participate in one visible learning and migration process.

## Open questions

- What is the smallest intent record that remains useful during an upgrade?
- How should bb identify related specs without collecting private user data?
- Who can approve team extensions and core overlays?
- How should two extensions negotiate changes to the same semantic surface?
- What evidence is enough to promote a repeated gap into a public capability?
- Can marketplaces distribute compatible variations of one intent without
  confusing users about which implementation they are installing?
