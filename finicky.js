const office_apps = ["Slack"]
const personal_apps = ["WhatsApp"]
const personal_websites = ["youtube.com", "facebook.com"]

module.exports = {
  defaultBrowser: "Google Chrome",
  options: {
    hideIcon: false,
    checkForUpdate: true,
  },
  handlers: [
    {
      match: ({ url }) => personal_websites.some(website => url.host.endsWith(website)),
      browser: {
        name: "Google Chrome",
        profile: "Profile 1"
      }
    },
    {
      match: ({ opener }) => {
        return office_apps.includes(opener.name)
      },
      browser: {
        name: "Google Chrome",
        profile: "Default",
      },
    },
    {
      match: ({ opener }) => {
        return personal_apps.includes(opener.name)
      },
      browser: {
        name: "Google Chrome",
        profile: "Profile 1",
      },
    },
    {
      match: ({ url }) => url.protocol === "slack",
      browser: "/Applications/Slack.app",
    },
  ],
};
