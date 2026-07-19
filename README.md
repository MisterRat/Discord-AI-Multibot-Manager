# 🤖 Discord AI Multibot Manager
A self-hosted web dashboard and management service to deploy, configure, monitor, and auto-start multiple independent AI-powered Discord bots simultaneously. Features real-time log streaming for each bot, individual target LLM settings, system resource metrics, and auto-start recovery using OpenAI or Gemini API compatible backends.

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


## 🐋 Deploying with Portainer
Portainer is a powerful UI for managing Docker containers. You can deploy this service easily as a Portainer **Stack** (Docker Compose).

### Step 1: Create a New Stack in Portainer
1. Open your Portainer dashboard.
2. Navigate to your local environment -> **Stacks** in the left sidebar.
3. Click the **Add stack** button in the top right.
4. Name your stack (e.g., `discord-ai-bot`).

### Step 2: Paste the Docker Compose Configuration
In the **Web editor** box, paste the following `docker-compose.yml` configuration:

```yaml
version: '3.8'

services:
  discord-ai-multibot-manager:
    image: node:20-alpine
    container_name: discord-ai-multibot-manager
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3010:3000"
    volumes:
      # Mount the entire project folder from your host (e.g. Synology NAS volume)
      - /volume1/docker/discord-ai-multibot-manager:/app
    environment:
      - NODE_ENV=production
    # This automatically installs, compiles, and starts the application inside the container
    command: sh -c "npm install --include=dev && npm run build && npm run start"
```

### Why we use Volumes
Without a volume, any settings you change in the web dashboard (like your Discord Token, prompts, and OpenAI/Gemini API Keys) will be wiped out whenever the container reboots or gets updated. 
The configuration above mounts your host project directory to `/app` inside the container to keep your `config.json` safe.  ⚠️ CRITICAL: all the files from this project need to be in the folder specified under "volumes" in the YAML; i.e. `/volume1/docker/discord-ai-multibot-manager`

### Step 3: Deploy the Stack
1. Scroll down to the bottom of the stack creation page.
2. Click **Deploy the stack**.
3. Wait about 1-2 minutes for Portainer to pull the Node image, install dependencies, compile the application, and start the web dashboard.

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
     - **API Target Endpoint & Key**: Configure your AI backend (Ollama, LM Studio, Groq, Gemini, or OpenAI official).
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
   - Located at the bottom of the left sidebar is the **UI Lock** status card.
   - Click **Setup** to set a custom passcode (PIN) to secure administrative actions.
   - Once set, the dashboard can be locked. When locked, sensitive credentials (like OpenAI API Keys and Discord Bot Tokens) are completely masked, and administrative actions (saving configurations, starting/stopping bots) are restricted.
   - **Accidental Lockout Protection**: To prevent lockouts from typos during passcode setup, clicking **Lock** will require you to verify your passcode first to confirm you remember it before the dashboard session is secured.

