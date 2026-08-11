# Private Tailscale Access

This is a future procedure for `chlela-bunker`; do not run it from the MyFlix container. Tailscale belongs on the Ubuntu host. MyFlix must remain private: do not use Funnel, router port forwarding, public DNS, public sharing links, or public port exposure.

## Intended path

```text
iPhone / Android -> private tailnet -> Tailscale Serve HTTPS
-> chlela-bunker host -> http://127.0.0.1:3000 -> MyFlix Docker
```

The final `*.ts.net` name is assigned by the tailnet and must not be guessed or hardcoded.

## Host setup

1. Confirm MyFlix is healthy locally:

```bash
curl --fail http://127.0.0.1:3000/health
```

2. Install Tailscale on the Ubuntu host using the current [official Linux instructions](https://tailscale.com/docs/install/linux). The official convenience path is:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Review the script or use Tailscale's distribution packages if preferred. Authenticate using the URL printed by `tailscale up`, then verify:

```bash
tailscale status
tailscale ip -4
```

3. Enable private HTTPS reverse proxying using the current [Tailscale Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve):

```bash
tailscale serve --bg 3000
tailscale serve status
```

Serve should report a tailnet-only HTTPS URL and proxy `/` to `http://127.0.0.1:3000`. `--bg` persists the Serve configuration across normal Tailscale restarts. Do not run `tailscale funnel`.

4. Open the reported HTTPS URL from another device already in the same tailnet and verify:

```text
https://<reported-hostname>.<reported-tailnet>.ts.net/health
https://<reported-hostname>.<reported-tailnet>.ts.net/desktop
```

5. After HTTPS is confirmed, set these server environment values and recreate the container:

```dotenv
COOKIE_SECURE=true
TRUST_PROXY=true
```

Native bearer authentication does not depend on cookies, but secure cookies protect browser sessions behind HTTPS. Do not add the URL to `ALLOWED_ORIGINS` for same-origin `/desktop` or `/mobile` use.

## Phone configuration

1. Install Tailscale on iOS or Android.
2. Sign into the same tailnet and confirm `chlela-bunker` is reachable. Family or friends must each be explicitly invited or granted access through the private tailnet policy.
3. In the native MyFlix client, choose **Change MyFlix Server**.
4. Enter the exact HTTPS URL printed by `tailscale serve status` without a trailing path.
5. Test the connection and sign in with the existing MyFlix account.
6. Disable Wi-Fi temporarily and test on cellular. Confirm library images, Direct playback, Range seeking, subtitles, HLS fallback, progress sync, and favorites.

If the app cannot connect, confirm both devices are online, MyFlix `/health` works on the host, Tailscale is connected, ACLs permit access, and `tailscale serve status` still shows the proxy. The app's connectivity message intentionally does not assume Tailscale is always the cause.

## Stop or reset Serve

Inspect current syntax before changing the private host setup. With current Tailscale releases:

```bash
tailscale serve status
tailscale serve reset
```

Reset removes Serve mappings; it does not remove MyFlix or its data. Keep tailnet ACLs limited to intended family/friend accounts and devices.
