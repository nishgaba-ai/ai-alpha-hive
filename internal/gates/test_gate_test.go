package gates

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestTestGateSkips(t *testing.T) {
	// non-web project
	res, _ := (&TestGate{}).Check(context.Background(), t.TempDir())
	if !res.Skipped {
		t.Fatal("expected skip without package.json")
	}

	// npm placeholder test script is "no tests", not "failing tests"
	dir := t.TempDir()
	write(t, dir, "package.json", `{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}`)
	os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755)
	res, _ = (&TestGate{}).Check(context.Background(), dir)
	if !res.Skipped || !res.Passed {
		t.Fatalf("placeholder test script must skip, got %+v", res)
	}

	// no test script at all
	dir2 := t.TempDir()
	write(t, dir2, "package.json", `{"scripts":{"build":"next build"}}`)
	os.MkdirAll(filepath.Join(dir2, "node_modules"), 0o755)
	res, _ = (&TestGate{}).Check(context.Background(), dir2)
	if !res.Skipped {
		t.Fatal("expected skip without a test script")
	}
}

func TestTestGateRunsRealScript(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "package.json", `{"scripts":{"test":"node -e \"process.exit(0)\""}}`)
	os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755)
	res, _ := (&TestGate{}).Check(context.Background(), dir)
	if res.Skipped || !res.Passed {
		t.Fatalf("passing test script should pass, got %+v", res)
	}

	dir2 := t.TempDir()
	write(t, dir2, "package.json", `{"scripts":{"test":"node -e \"process.exit(1)\""}}`)
	os.MkdirAll(filepath.Join(dir2, "node_modules"), 0o755)
	res, _ = (&TestGate{}).Check(context.Background(), dir2)
	if res.Passed {
		t.Fatal("failing test script must fail the gate")
	}
}
