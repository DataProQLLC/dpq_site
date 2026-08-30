# Adding the policy pages to dpq_site

## Files

```
index.html    replaces the existing one (adds FinApp + footer links)
privacy.html  new
terms.html    new
```

`CNAME` and `README.md` are unchanged.

## Deploy

```bash
cd dpq_site
# copy the three files in, then
git add index.html privacy.html terms.html
git commit -m "add privacy policy and terms of service"
git push
```

GitHub Pages rebuilds in about a minute. Because `CNAME` already holds
`dataproqllc.com`, the URLs are:

```
https://dataproqllc.com/privacy.html
https://dataproqllc.com/terms.html
```

Verify from outside your network before resubmitting to Twilio:

```bash
curl -sI https://dataproqllc.com/privacy.html | head -1   # expect HTTP/2 200
curl -sI https://dataproqllc.com/terms.html   | head -1   # expect HTTP/2 200
```

If Pages is not enabled: repo Settings -> Pages -> Source: `main`, `/ (root)`.

## Style

Matched to the existing index.html exactly -- same font stack, 620px column,
80px/24px padding, `#1a6b4f` green links, `#e5e5e5` rules. The only addition is
a left-bordered callout for the SMS clauses, in the same green, so a reviewer
can find that language quickly.

## Why index.html changed

Your site described Ultra only. The A2P campaign is for FinApp, so a reviewer
landing on dataproqllc.com would see a product that is not the one sending
texts -- an easy rejection. The new index names both, and describes FinApp's
sign-in methods in the same terms the campaign registration does.

Footer links to both policies are added, which reviewers also look for.

## Resubmitting to Twilio

**Privacy policy URL:** `https://dataproqllc.com/privacy.html`
**Terms of service URL:** `https://dataproqllc.com/terms.html`

**How do end-users consent to receive messages?** Replace the vague draft with
the real flow:

> Users enter their mobile number in the FinApp mobile app to sign in or create
> an account. The number entry screen displays "By continuing you agree to the
> Terms of Service and Privacy Policy" with links to both documents. Submitting
> the number triggers a one-time passcode sent by SMS. Consent is obtained at
> the point of number entry and is required only to receive the sign-in
> passcode. No marketing messages are sent.

**Sample message**, if asked:

```
Your FinApp verification code is 123456. Reply STOP to opt out, HELP for help.
Msg&data rates may apply.
```

Update the live template to match, under
Supabase -> Auth -> Providers -> Phone -> SMS Message:

```
Your FinApp verification code is {{ .Code }}. Reply STOP to opt out, HELP for help. Msg&data rates may apply.
```

## One app change worth making first

The auth screen already reads "By continuing you agree to the Terms of Service
and Privacy Policy", but it is plain text. Make both phrases tappable links to
these URLs -- reviewers open the app when they can, and the consent description
above claims the links are there.
