package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	checkPath := getInput("INPUT_PATH", ".")
	excludeRaw := getInput("INPUT_EXCLUDE", "**/node_modules/**\n**/.git/**")
	failOnViolation := strings.EqualFold(getInput("INPUT_FAIL-ON-VIOLATION", "true"), "true")

	excludePatterns := parseList(excludeRaw)
	workdir, err := filepath.Abs(checkPath)
	if err != nil {
		setFailed(fmt.Sprintf("Failed to resolve path: %v", err))
	}

	fmt.Printf("::info::Checking for scripts in package.json files in: %s\n", workdir)

	files, err := findPackageJsonFiles(workdir, excludePatterns)
	if err != nil {
		setFailed(fmt.Sprintf("Failed to find package.json files: %v", err))
	}

	var violations []string
	for _, file := range files {
		hasScripts, err := checkPackageJson(file)
		if err != nil {
			fmt.Printf("::warning::Failed to parse %s: %v\n", file, err)
			continue
		}
		if hasScripts {
			violations = append(violations, file)
		}
	}

	reportToConsole(files, violations, workdir)

	setOutput("files-checked", fmt.Sprintf("%d", len(files)))
	setOutput("files-with-scripts", fmt.Sprintf("%d", len(violations)))
	violationJSON, _ := json.Marshal(violations)
	if violations == nil {
		violationJSON = []byte("[]")
	}
	setOutput("violation-list", string(violationJSON))

	if failOnViolation && len(violations) > 0 {
		setFailed(fmt.Sprintf("Found %d package.json files with scripts sections. Use justfiles instead.", len(violations)))
	}
}

func getInput(envVar, defaultVal string) string {
	if val := os.Getenv(envVar); val != "" {
		return val
	}
	return defaultVal
}

func parseList(input string) []string {
	var result []string
	for _, line := range strings.FieldsFunc(input, func(r rune) bool {
		return r == '\n' || r == ','
	}) {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func findPackageJsonFiles(root string, excludePatterns []string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		relPath, _ := filepath.Rel(root, path)

		if d.IsDir() {
			for _, pattern := range excludePatterns {
				if matchGlob(pattern, relPath+"/") {
					return filepath.SkipDir
				}
			}
			return nil
		}

		if d.Name() != "package.json" {
			return nil
		}

		for _, pattern := range excludePatterns {
			if matchGlob(pattern, relPath) {
				return nil
			}
		}

		files = append(files, path)
		return nil
	})
	return files, err
}

// matchGlob handles glob patterns including ** for recursive matching.
func matchGlob(pattern, name string) bool {
	// Normalize separators
	pattern = filepath.ToSlash(pattern)
	name = filepath.ToSlash(name)

	return doMatch(pattern, name)
}

func doMatch(pattern, name string) bool {
	for len(pattern) > 0 {
		if strings.HasPrefix(pattern, "**/") {
			pattern = pattern[3:]
			// ** matches zero or more path segments
			if doMatch(pattern, name) {
				return true
			}
			for i := 0; i < len(name); i++ {
				if name[i] == '/' {
					if doMatch(pattern, name[i+1:]) {
						return true
					}
				}
			}
			return false
		}

		if strings.HasSuffix(pattern, "/**") {
			pattern = pattern[:len(pattern)-3]
			// Check if name starts with pattern prefix
			if strings.HasPrefix(name, pattern+"/") || name == pattern {
				return true
			}
			return false
		}

		// Find the next ** in the pattern
		idx := strings.Index(pattern, "/**/")
		if idx >= 0 {
			prefix := pattern[:idx]
			rest := pattern[idx+4:]
			if !matchSegment(prefix, name) {
				// Try to match prefix against path segments
				for i := 0; i < len(name); i++ {
					if name[i] == '/' {
						if matchSegment(prefix, name[:i]) {
							return doMatch("**/"+rest, name[i+1:])
						}
					}
				}
				return false
			}
			return doMatch("**/"+rest, name[len(prefix)+1:])
		}

		// No ** remaining, use filepath.Match
		matched, _ := filepath.Match(pattern, name)
		return matched
	}
	return len(name) == 0
}

func matchSegment(pattern, name string) bool {
	matched, _ := filepath.Match(pattern, name)
	return matched
}

func checkPackageJson(filePath string) (bool, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return false, err
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return false, err
	}

	_, hasScripts := raw["scripts"]
	return hasScripts, nil
}

func reportToConsole(files []string, violations []string, workdir string) {
	fmt.Println()
	fmt.Println("No Scripts Check")
	fmt.Println("================")
	fmt.Println()

	if len(violations) == 0 {
		fmt.Printf("\u2705 All %d package.json files are scripts-free\n", len(files))
		return
	}

	fmt.Printf("\u274c Found %d package.json files with scripts sections:\n\n", len(violations))

	for _, file := range violations {
		relPath, _ := filepath.Rel(workdir, file)
		fmt.Printf("  \u2022 %s\n", relPath)
		fmt.Printf("::error file=%s,line=1,title=Scripts Section Found::package.json contains scripts section - use a justfile instead\n", relPath)
	}

	fmt.Println("\n\U0001f4a1 Tip: Move scripts to a justfile and remove the scripts section from package.json")
}

func setOutput(name, value string) {
	outputFile := os.Getenv("GITHUB_OUTPUT")
	if outputFile == "" {
		fmt.Printf("::set-output name=%s::%s\n", name, value)
		return
	}

	f, err := os.OpenFile(outputFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not write to GITHUB_OUTPUT: %v\n", err)
		fmt.Printf("::set-output name=%s::%s\n", name, value)
		return
	}
	defer f.Close()

	if strings.ContainsAny(value, "\n\r") {
		delimiter := "ghadelimiter_no_scripts"
		fmt.Fprintf(f, "%s<<%s\n%s\n%s\n", name, delimiter, value, delimiter)
	} else {
		fmt.Fprintf(f, "%s=%s\n", name, value)
	}
}

func setFailed(msg string) {
	fmt.Printf("::error::%s\n", msg)
	os.Exit(1)
}
