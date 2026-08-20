// Package config loads and writes hive.yaml — the declared half of the
// intent graph. See docs/intent-graph.md for the full spec.
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// FileName is the project manifest hive looks for at the repo root.
const FileName = "hive.yaml"

// Config is the declared intent of a hive-managed project.
type Config struct {
	Site  Site            `yaml:"site"`
	Pages map[string]Page `yaml:"pages,omitempty"`
}

// Site captures project-wide intent.
type Site struct {
	Name     string    `yaml:"name"`
	Intent   string    `yaml:"intent"`
	Audience []string  `yaml:"audience,omitempty"`
	Journeys []Journey `yaml:"journeys,omitempty"`
}

// Journey is a named user path through the site.
type Journey struct {
	Name  string   `yaml:"name"`
	Steps []string `yaml:"steps"`
}

// Page declares what a single route is for.
type Page struct {
	Intent   string   `yaml:"intent,omitempty"`
	Keywords []string `yaml:"keywords,omitempty"`
	Sections []string `yaml:"sections,omitempty"`
}

// Load reads hive.yaml from dir.
func Load(dir string) (*Config, error) {
	b, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		return nil, err
	}
	var c Config
	if err := yaml.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", FileName, err)
	}
	return &c, nil
}

// Save writes the config to dir/hive.yaml.
func Save(dir string, c *Config) error {
	b, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, FileName), b, 0o644)
}

// Exists reports whether dir already has a hive.yaml.
func Exists(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, FileName))
	return err == nil
}
