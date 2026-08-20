// Package envfile loads .env files per the portability contract: all
// machine-specific configuration lives in environment variables, and a .env
// file is the local way to provide them. Values never override variables
// already set in the process environment.
package envfile

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Load finds the nearest .env walking up from dir and applies it to the
// process environment. Missing .env is not an error — the variables may be
// set in the environment directly (CI, containers).
func Load(dir string) error {
	path, ok := find(dir)
	if !ok {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key == "" || value == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
	return sc.Err()
}

func find(dir string) (string, bool) {
	for {
		candidate := filepath.Join(dir, ".env")
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			return candidate, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
