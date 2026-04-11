# All-in-One Message Notifications (Inbox-Radar)

Get one clear alert when a background tab looks like it has new activity (for example Gmail, WhatsApp Web, Slack). You choose which sites to watch with simple filters.

**Chrome Web Store:** [All-in-One Message Notifications](https://chromewebstore.google.com/detail/all-in-one-message-notifi/cefobdcaibndecpfofboeiebejehmjpb)

**Source / issues:** [GitHub](https://github.com/asfixia/Inbox-Radar)

## What it uses from your browser

- Only the **tab title** and **URL**. It does **not** read page content or messages.
- Everything stays **on your computer**. No analytics or remote server.

## How to start

1. Install the extension. On first install, a **welcome** tab opens with steps to **pin** the icon (Chrome cannot pin it for you).
2. Click the toolbar icon to open the **small popup** (same UI as **Options**).
3. Open **Filters** and keep or edit the suggested rules.
4. Open **Advanced**:
   - **Notification type:** badge only, desktop notifications, or both.
   - **Warnings:** turn each alert channel on or off (all on by default).

## Alerts you can use

| Channel | What it does |
|--------|----------------|
| Toolbar badge | Shows how long the oldest unread site has been waiting; color can change over time. |
| Desktop notification | Title = site hostname (e.g. `web.whatsapp.com`). Text includes the tab title and “New activity detected.” |
| Persistent notification | Stays on screen until you dismiss it (where the OS supports it). |
| Sound | Asks the OS for sound; Windows or “Do not disturb” may still mute it. |
| Toolbar tooltip | **Hover** the icon: a short summary of unread sites and tab titles (updates when something changes). |
| Desktop summary list | In **Advanced**, use **Show unread summary as desktop notification** (if that option is enabled). |

**Same hostname, several tabs:** unread state is **one row per site**. Opening **any** tab of that site marks the whole site as read.

## If you “don’t see” desktop notifications

- Windows: **Settings → System → Notifications** (allow Chrome).
- Windows: **Focus Assist** off (or allow Chrome through).
- Chrome: `chrome://settings/content/notifications` — notifications allowed for sites is separate from **extension** notifications, but DND still blocks toasts sometimes.
- Use **Advanced → Test all enabled notifications** to preview badge, desktop alerts, and summary list (according to your settings).

## FAQ

**Why did nothing happen when the tab title changed?**  
The extension watches tab updates; some sites only change the title once. If nothing triggers, add a **title** or **URL** filter that matches how that site behaves.

**Does it read my messages?**  
No. Only **title** and **URL** of each tab.

## Screenshots (for the store listing)

Add 2–4 images here or in the store console: main window with filters, Advanced warnings, and a sample desktop notification.

## Contributing

Issues and pull requests: [GitHub](https://github.com/asfixia/Inbox-Radar).

## Changelog

Current **version** is in [`manifest.json`](manifest.json). Bump it when you publish. You can add release notes in git tags or in this section over time.

## Permissions (short)

- **Tabs:** read titles and URLs.
- **Storage:** save your filters and settings.
- **Notifications:** desktop toasts.
- **Windows:** optional fallback to open the UI from the welcome page if the compact popup cannot be opened.
- **Host access `*://*/*`:** so your filters can match any site you choose.
