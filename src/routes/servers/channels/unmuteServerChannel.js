const Channels = require("../../../models/channels");
const Messages = require("../../../models/messages");
const Notifications = require("../../../models/notifications");
const ServerMembers = require("../../../models/ServerMembers");

module.exports = async (req, res, next) => {
  const { channel_id, server_id } = req.params;

  // check if channel exists in server.
  if (req.channel.server_id !== server_id) {
    return res.status(403).json({ message: "Channel not found." });
  }

  await ServerMembers.updateOne(
    { member: req.user._id, server_id: req.channel.server_id },
    {$pull: { muted_channels: channel_id } }
  );

  res.json({ message: "Channel unmuted." });

  const io = req.io;
  io.in(req.user.uniqueID).emit("channel:unmute", {channelID: channel_id});
};
