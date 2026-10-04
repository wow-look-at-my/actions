# ste-lint

A name kept for the repositories that already call it. It runs the [slopfix](https://github.com/wow-look-at-my/slopfix) action, which checks the whole checkout with every rule, the hard-wrap and STE rules included. It takes no input, because an input that narrows the check lets a caller switch it off.

```yaml
- uses: actions/checkout@v4
- uses: wow-look-at-my/actions@ste-lint#latest
```

`slopfix fix <file>` repairs most findings. slopfix's own documentation says what each rule reads.
