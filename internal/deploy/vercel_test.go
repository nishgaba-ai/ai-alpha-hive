package deploy

import "testing"

func TestDeploymentURL(t *testing.T) {
	cases := []struct {
		name, out, want string
	}{
		{
			"plain line output",
			"Inspect: https://vercel.com/acme/site/abc\nhttps://site-abc123.vercel.app\n",
			"https://site-abc123.vercel.app",
		},
		{
			"json summary output",
			`{"inspectorUrl":"https://vercel.com/acme/site/abc","url":"https://site-abc123.vercel.app","next":[{"command":"vercel deploy --prod"}]}`,
			"https://site-abc123.vercel.app",
		},
		{
			"inspector only",
			"Inspect: https://vercel.com/acme/site/abc\n",
			"",
		},
		{"no urls", "nothing here", ""},
	}
	for _, tc := range cases {
		if got := deploymentURL(tc.out); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
