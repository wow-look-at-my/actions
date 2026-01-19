# Multi-Command Action

Run OS-specific commands in a single step without boilerplate if-checks.

## Usage

```yaml
- uses: wow-look-at-my-code/actions/multicmd@v1
  with:
    default: echo "Hello from any OS"
    windows: Write-Host "Hello from Windows"
    linux: echo "Hello from Linux"
    macos: echo "Hello from macOS"
```

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `default` | Command to run if no OS-specific command is provided | No |
| `windows` | Command to run on Windows (uses pwsh) | No |
| `linux` | Command to run on Linux (uses bash) | No |
| `macos` | Command to run on macOS (uses bash) | No |
| `unix` | Command to run on Linux and macOS (uses bash) | No |

## Behavior

Priority order for Linux/macOS: `linux`/`macos` > `unix` > `default`

- If an OS-specific input (`linux`/`macos`) is provided, it runs that command
- Otherwise, if `unix` is provided, it runs on Linux and macOS
- Otherwise, if `default` is provided, it runs that
- If none are provided, nothing runs for that OS

## Examples

### Same command on all platforms

```yaml
- uses: wow-look-at-my-code/actions/multicmd@v1
  with:
    default: npm test
```

### Different commands per OS

```yaml
- uses: wow-look-at-my-code/actions/multicmd@v1
  with:
    windows: choco install jq
    linux: sudo apt-get install -y jq
    macos: brew install jq
```

### Override default for one OS

```yaml
- uses: wow-look-at-my-code/actions/multicmd@v1
  with:
    default: ./build.sh
    windows: .\build.ps1
```

### Unix (Linux + macOS) vs Windows

```yaml
- uses: wow-look-at-my-code/actions/multicmd@v1
  with:
    unix: ./install.sh
    windows: .\install.ps1
```
