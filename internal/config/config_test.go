package config

import "testing"

func TestRoundTrip(t *testing.T) {
	dir := t.TempDir()
	in := &Config{
		Site: Site{
			Name:     "bakery-demo",
			Intent:   "Get Ahmedabad locals to order cakes on WhatsApp",
			Audience: []string{"local families"},
			Journeys: []Journey{{Name: "order", Steps: []string{"home", "/menu", "/order"}}},
		},
		Pages: map[string]Page{
			"/menu": {Intent: "showcase: signature cakes", Keywords: []string{"cakes ahmedabad"}},
		},
	}
	if Exists(dir) {
		t.Fatal("Exists true before save")
	}
	if err := Save(dir, in); err != nil {
		t.Fatal(err)
	}
	if !Exists(dir) {
		t.Fatal("Exists false after save")
	}
	out, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if out.Site.Name != in.Site.Name || out.Site.Intent != in.Site.Intent {
		t.Fatalf("site mismatch: %+v", out.Site)
	}
	if len(out.Site.Journeys) != 1 || out.Site.Journeys[0].Steps[1] != "/menu" {
		t.Fatalf("journeys mismatch: %+v", out.Site.Journeys)
	}
	if out.Pages["/menu"].Keywords[0] != "cakes ahmedabad" {
		t.Fatalf("pages mismatch: %+v", out.Pages)
	}
}
