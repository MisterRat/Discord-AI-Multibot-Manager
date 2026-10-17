# 🤖 Discord AI Multibot Manager
A self-hosted web dashboard and management service to deploy, configure, monitor, and auto-start multiple independent AI-powered Discord bots simultaneously. Features real-time log streaming for each bot, individual target LLM settings, system resource metrics, and auto-start recovery using OpenAI or Gemini API compatible backends.

![Discord AI Multibot Manager Dashboard](./assets/screenshot.png)

---

## 🛠 Prerequisite: Create Your Discord Bot
Setting up a Discord Bot for the first time can be confusing. Follow these exact steps to obtain the correct keys and grant the necessary permissions.

### Step 1: Create a Discord Developer Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in with your Discord account.
2. Click the **New Application** button in the top right.
3. Give your bot a name (e.g., `My AI Assistant`) and click **Create**.

### Step 2: Retrieve Your Bot Token (Crucial)
> ⚠️ **Newbie Warning:** The token you need is the **Bot Token**. It is **NOT** the "Client ID", "Client Secret", or "Public Key" shown on the *General Information* page. Treat your Bot Token like a password—never share it.

1. In the left-hand menu, click on the **Bot** tab.
2. Under the username section, click the **Reset Token** button.
3. Confirm the reset, and a long string of characters separated by dots (e.g., `MTg4M...`) will appear.
4. Click **Copy** and save it somewhere secure immediately. *Note: Once you leave this page, Discord will hide it, and you will have to reset it again to copy it.*

### Step 3: Enable Privileged Gateway Intents (Mandatory)
If you do not do this step, the bot will join your server but will be unable to read any messages or respond to anything.

1. While still on the **Bot** tab, scroll down to the **Privileged Gateway Intents** section.
2. Locate the following three switches and toggle them **ON**:
   - **Presence Intent**
   - **Server Members Intent** (Allows the bot to see member statistics)
   - **Message Content Intent** (⚠️ **Absolutely CRITICAL!** Allows the bot to read messages so it can process AI queries)
3. Click **Save Changes** at the bottom of the screen.

### Step 4: Generate Your Bot Invitation Link
1. In the left-hand menu, navigate to **OAuth2** and select the sub-item **URL Generator**.
2. In the **Scopes** grid, check only the box for **bot**.
3. A new **Bot Permissions** grid will appear below. Check the following permissions:
   - **Read Messages/View Channels**
   - **Send Messages**
   - **Embed Links**
   - **Attach Files**
   - **Read Message History** (Crucial so the bot understands conversation context)
4. Scroll to the bottom of the page and locate the **Generated URL**.
5. Copy this URL, paste it into a new browser tab, select your Discord server, and click **Authorize**. Your bot is now added to your server!

---

> 💡 **Multibot Management Note:** Since this application supports running **multiple independent bots simultaneously**, you can repeat the prerequisite steps above for each Discord bot account you wish to create. Each bot in your dashboard will have its own custom token, custom prompt, and custom trigger behaviors!

---


## 🐋 Deploying with Portainer (from GitHub)
Portainer can pull this repository, build it and start it for you. No files need to be copied or edited on your server.

### Step 1: Create the stack
1. Open Portainer and select your environment (usually **local** or **primary**).
2. Click **Stacks** in the left sidebar, then **+ Add stack**.
3. **Name**: `discord-ai-multibot-manager` (lowercase).
4. **Build method**: choose **Repository**.
5. **Repository URL**: `https://github.com/MisterRat/Discord-AI-Multibot-Manager`
6. **Repository reference**: `refs/heads/main`
7. **Compose path**: `docker-compose.yml`
8. Click **Deploy the stack**. The first build takes a few minutes.

### Step 2: Get the one-time setup token
1. In Portainer, go to **Containers** and click **discord-ai-multibot-manager**.
2. Click **Logs**. You will see a box containing **One-time setup token: XXXX-XXXX-XXXX**.
3. Open `http://<your-server-ip>:3010`, click **Setup** under **UI Lock** (bottom left), enter the token and choose your passcode.

### Updating to a new version
Open the stack in Portainer and click **Pull and redeploy**. Portainer fetches the latest code and rebuilds the image. *(Optional: under **GitOps updates** you can turn on automatic updates.)*

### Where your settings are kept
Bot tokens, API keys, prompts and your passcode are stored in a Docker volume named `discord-ai-multibot-manager_multibot_data` (Portainer → **Volumes**). It is kept when you redeploy or update. Only deleting that volume erases your settings.

### Alternative: Docker Compose from the command line
```bash
git clone https://github.com/MisterRat/Discord-AI-Multibot-Manager.git
cd Discord-AI-Multibot-Manager
docker compose up -d --build
```

---

## 💻 Initial Dashboard Setup

1. Open your web browser and navigate to `http://<your-server-ip>:3010` (or whichever port you mapped your container's port `3000` to, e.g., `http://localhost:3010`).
2. You will be greeted by the **Discord AI Multibot Manager** dashboard.
3. **Select or Create a Bot Instance**:
   - By default, a **Primary Bot** instance is pre-configured.
   - To add more bots, click **+ Add bot** in the top-right of the **Bot Instances** sidebar panel, enter a name, and hit create.
4. **Configure Your Bot Instance**:
   - Select your bot from the left sidebar.
   - Go to the **AI Settings** tab to set:
     - **Bot Instance Name**: Custom nickname for your dashboard.
     - **API Target Endpoint & Key**: Configure your OpenAI API compatible backend (Open WebUI, Gemini, OpenAI official, etc.)
       > 💡 **Gemini API Tip:** Enter `https://generativelanguage.googleapis.com/v1beta/openai` as your base URL.  Go to `https://aistudio.google.com/projects` to create a project and get a key. 
     - **Target AI Model ID**: Use custom IDs or fetch the automatic list from your endpoint.
   - Go to the **Triggers & Access** tab to set:
     - **Discord Token**: Paste the token copied in *Prerequisite: Step 2*.
     - **Behavior**: Choose if the bot responds to direct mentions, DMs, or custom prefixes (e.g., `!`).
     - **Channel/Guild Whitelists**: Restrict the bot to specific Discord channels or server IDs if desired.
     - **Auto-Start**: Toggle **Auto-Start on Reboot** so this specific bot instance logs back into Discord automatically when the container restarts.
5. **Save and Start**:
   - Click **Save Settings** at the bottom of the configuration forms.
   - Click the **Start Bot** button in the header bar or the dashboard actions panel.
6. **Monitor and Manage**:
   - Use the **Dashboard** and **Terminal Logs** tabs to view live logs, track connection latency, and check active guild/member count.
   - Keep track of total chats, system SLA metrics, and Docker container CPU/RAM allocations directly from the sidebar.
7. **Secure Your Instance (UI Security Lock)**:
   - Located at the bottom of the left sidebar is the **UI Lock** status card. Until a passcode is set, anyone who can open the dashboard can control your bots, so set one right away.
   - Click **Setup** and choose a passcode of at least 6 characters. Unless your browser is on the server itself, you will also be asked for the **one-time setup token**. It is printed in the server log at startup while no passcode is set; in Portainer or Synology Container Manager, open the container's **Logs**. This stops someone else on your network from claiming the dashboard first.
   - Once a passcode is set, the dashboard, live logs and every bot control require it. A browser stays signed in for 12 hours (or until you click **Lock**, change the passcode, or restart the container).
   - Saved Discord tokens and API keys are never sent to the browser, locked or not. The fields show that a value is saved; type a new one to replace it. Leaving a field blank keeps the saved value.
   - Repeated wrong passcodes are slowed down (5 tries per 15 minutes per address).
   - **Accidental Lockout Protection**: clicking **Lock** asks you to type your passcode first, so a typo during setup can't lock you out.
   - **Forgot the passcode?** In Portainer, open the stack, add an environment variable `RESET_ADMIN_PASSCODE` = `true`, and click **Update the stack** (or **Pull and redeploy**). The passcode is cleared and a new setup token appears in the container log. Set a new passcode, then remove the variable and update the stack again.

8. **Abuse protection in Discord**:
   - Bot replies can never ping `@everyone`, `@here`, roles or other users, whatever the AI writes.
   - Each bot has a **Per-User Cooldown** (Triggers & Access tab, default 5 seconds). Messages sent faster than that get a ⏳ reaction instead of an AI reply.

---

## 🔄 Upgrading from 1.1.x
- Your existing passcode keeps working. It is converted to a secure hash in `config.json` the first time the new version starts.
- When a passcode is set, the dashboard no longer shows anything until you unlock it.
- **If your dashboard was ever reachable by other people on your network or the internet, reset your Discord bot tokens and AI API keys.** Earlier versions sent them to any browser that asked, even while locked.
