const ServerMembers = require("../../models/ServerMembers");
const Messages = require("../../models/messages");
const matchAll = require("match-all");
const Users = require("../../models/users");
const Channels = require("../../models/channels");
const Devices = require("../../models/Devices");

const sendMessageNotification = require('./../../utils/SendMessageNotification');

import pushNotification from '../../utils/sendPushNotification'

module.exports = async (req, res, next) => {
  const { channelID } = req.params;
  const { tempID, message, socketID, color } = req.body;
  let _color;
  if (typeof color === 'string' && color.startsWith('#')) {
    _color = color.substring(0, 7);
  }

  if (!message || message.trim() === "") return next();

  if (message.length > 5000) {
    return res.status(403).json({
      status: false,
      message: "Message must contain characters less than 5,000"
    });
  }

  // converted to a Set to remove duplicates.
  let mentionIds = Array.from(new Set(matchAll(message, /<@([\d]+)>/g).toArray()));

  const mentions = mentionIds.length ? await Users.find({uniqueID: {$in: mentionIds}}).select('_id uniqueID avatar tag username').lean() : [];

  const _idMentionsArr = mentions.map(m => m._id )
  


  let query = {
    channelID,
    message,
    creator: req.user._id,
    messageID: "placeholder",
    mentions: _idMentionsArr
  }
  if (_color) query['color'] = _color;

  const messageCreate = new Messages(query)

  let messageCreated = await messageCreate.save();

  const user = {
    uniqueID: req.user.uniqueID,
    username: req.user.username,
    tag: req.user.tag,
    avatar: req.user.avatar,
    admin: req.user.admin
  };

  messageCreated = {
    channelID,
    message,
    color: _color,
    creator: user,
    created: messageCreated.created,
    mentions,
    messageID: messageCreated.messageID
  };

  res.json({
    status: true,
    tempID,
    messageCreated
  });

  req.message_status = true;
  req.message_id = messageCreated.messageID;
  next();

  // emit
  const io = req.io;

  if (req.channel.server) {
    return serverMessage();
  } else {
    return directMessage();
  }

  async function serverMessage() {


    const clients =
      io.sockets.adapter.rooms["server:" + req.channel.server.server_id]
        .sockets;
    for (let clientId in clients) {
      if (clientId !== socketID) {
        io.to(clientId).emit("receiveMessage", {
          message: messageCreated
        });
      }
    }


    //send notification
    const uniqueIDs = await sendMessageNotification({
      message: messageCreated,
      channelID,
      server_id: req.channel.server._id,
      sender: req.user,
    })


    pushNotification({
      channel: req.channel,
      isServer: true,
      message: messageCreated,
      uniqueIDArr: uniqueIDs,
      user: req.user
    })


    return;
  }

  async function directMessage() {

    const isSavedNotes = req.user.uniqueID === req.channel.recipients[0].uniqueID

    // checks if its sending to saved notes or not.
    if (!isSavedNotes) {
      //change lastMessage timeStamp
      const updateChannelTimeStamp = Channels.updateMany(
        {
          channelID
        },
        {
          $set: {
            lastMessaged: Date.now()
          }
        },
        {
          upsert: true
        }
      );

    // sends notification to a user.

      const sendNotification = sendMessageNotification({
        message: messageCreated,
        recipient_uniqueID: req.channel.recipients[0].uniqueID,
        channelID,
        sender: req.user,
      })
      await Promise.all([updateChannelTimeStamp, sendNotification]);
    }




    if (!isSavedNotes){
      // for group messaging, do a loop instead of [0]
      io.in(req.channel.recipients[0].uniqueID).emit("receiveMessage", {
        message: messageCreated
      });
    }

    // Loop for other users logged in to the same account and emit (exclude the sender account.).
    //TODO: move this to client side for more performance.
    const rooms = io.sockets.adapter.rooms[req.user.uniqueID];
    if (rooms)
      for (let clientId in rooms.sockets || []) {
        if (clientId !== socketID) {
          io.to(clientId).emit("receiveMessage", {
            message: messageCreated,
            tempID
          });
        }
      }


    if (!isSavedNotes)
      pushNotification({
        user: req.user,
        message: messageCreated,
        recipient: req.channel.recipients[0],
        isServer: false,
      })  

  }
};