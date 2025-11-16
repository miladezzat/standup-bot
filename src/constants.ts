export const MESSAGE_BLOCKS = [
    {
        type: "section",
        text: {
            type: "mrkdwn",
            text: ":wave: *Good morning, team!*\n\nIt's time for our daily standup."
        }
    },
    {
        type: "section",
        text: {
            type: "mrkdwn",
            text: "*Please reply in this thread* with your updates:"
        }
    },
    {
        type: "section",
        text: {
            type: "mrkdwn",
            text: "• *What did you accomplish yesterday?*\n• *What are your plans for today?*\n• *Any blockers or challenges?*\n• *Any notes or context for the team?*"
        }
    },
    {
        type: "context",
        elements: [
            {
                type: "mrkdwn",
                text: "Thank you for keeping us all aligned! :rocket:"
            }
        ]
    }
]
