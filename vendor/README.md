# (obsolete) touchstone vendoring

Touchstone is **no longer vendored as a tarball**. It's installed straight from
its git tag — see the dependency line in `../package.json`:

```
"touchstone": "github:jayapalb/touchstone#v0.8.1"
```

To move to another version, change the tag and reinstall — one character:

```
#v0.8.1  →  #v0.9.0     then: npm install
```

Drift is visible two ways now, so the old "refresh the tarball" discipline is
automatic — the channel enforces it:
- the version you're on is right there in the dependency line;
- `npm outdated touchstone` flags it against the repo's tags.

This `vendor/` directory is dead — safe to delete.
