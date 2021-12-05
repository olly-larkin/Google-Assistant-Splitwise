const { conversation } = require('@assistant/conversation');
const functions = require('firebase-functions');
const Splitwise = require('splitwise');
const Fuse = require('fuse.js');

const CHARGE = 'charge';
const PAY = 'pay';

const app = conversation();

const sw = Splitwise({
  consumerKey: 'xE1iqzMCQHGNhg5zNnzQBidh0mRQXudQa98nXs4M',
  consumerSecret: 'Zta9XaVYnjsfZ7lf3lbeYfe80xjbtAvorcp84cf9'
});

const friendFuseOptions = {
  keys: ['first_name', 'last_name'],
};

const groupFuseOptions = {
  keys: ['name'],
};

const getFriendForDisplay = (friend) => `${friend.first_name}${friend.last_name ? ` ${friend.last_name}` : ''}`;
const getGroupForDisplay = (group) => `${group.name}`;

const getClosestMatch = (element, arr, options) => {
  const fuse = new Fuse(arr, options);
  const searchResult = fuse.search(element)[0];
  return searchResult ? searchResult.item : undefined;
};

const setupTransaction = async (conv, transactionType) => {
  conv.session.params.type = undefined;
  conv.session.params.friend = undefined;
  conv.session.params.group = undefined;
  conv.session.params.pounds = undefined;
  conv.session.params.pence = undefined;
  conv.session.params.description = undefined;
  conv.session.params.confirmation_message = undefined;

  const tryAgain = () => {
    conv.add('Sorry I didn\'t catch that. Try again? ');
    conv.scene.next.name = 'Splitwise';
  };

  if (!conv.intent.params.name || !conv.intent.params.pounds) {
    tryAgain();
    return;
  }

  const name = conv.intent.params.name.original;
  const pounds = conv.intent.params.pounds.original;
  const pence = conv.intent.params.pence ? conv.intent.params.pence.original : undefined;
  const group = conv.intent.params.group ? conv.intent.params.group.original : undefined;

  const closestFriend = getClosestMatch(name, await sw.getFriends(), friendFuseOptions);
  if (!closestFriend) {
    tryAgain();
    return;
  }

  var message = `Would you like to ${transactionType} ${getFriendForDisplay(closestFriend)}`;

  var closestGroup;
  if (group) {
    closestGroup = getClosestMatch(group, await sw.getGroups(), groupFuseOptions);

    if (!closestGroup) {
      tryAgain();
      return;
    }

    if (!closestGroup.members.some(gm => gm.id === closestFriend.id)) {
      conv.add(`${getFriendForDisplay(closestFriend)} is not a member of group ${getGroupForDisplay(closestGroup)}. Let's try again. `);
      conv.scene.next.name = 'Splitwise';
      return;
    }

    message += ` in group ${getGroupForDisplay(closestGroup)}`;
  }

  message += ` £${pounds}${pence ? `.${pence}` : ''}`;

  conv.session.params.type = transactionType;
  conv.session.params.friend = closestFriend;
  conv.session.params.group = closestGroup;
  conv.session.params.pounds = pounds;
  conv.session.params.pence = pence;
  conv.session.params.confirmation_message = message;
};

app.handle('charge', async (conv) => await setupTransaction(conv, CHARGE));

app.handle('pay', async (conv) => await setupTransaction(conv, PAY));

app.handle('add_description', (conv) => {
  conv.session.params.description = conv.intent.params.description.original;
  conv.session.params.confirmation_message += ` with transaction description '${conv.session.params.description}'?`;

  conv.add(conv.session.params.confirmation_message);
});

app.handle('confirm', async (conv) => {
  const me = await sw.getCurrentUser();

  try {
    if (conv.session.params.type == CHARGE) {
      await sw.createDebt({
        from: me.id,
        to: conv.session.params.friend.id,
        group_id: conv.session.params.group ? conv.session.params.group.id : undefined,
        description: conv.session.params.description,
        amount: parseFloat(conv.session.params.pounds) + ((conv.session.params.pence ? parseInt(conv.session.params.pence) : 0) / 100),
      });
    } else if (conv.session.params.type == PAY) {
      await sw.createDebt({
        from: conv.session.params.friend.id,
        to: me.id,
        group_id: conv.session.params.group ? conv.session.params.group.id : undefined,
        description: conv.session.params.description,
        amount: parseFloat(conv.session.params.pounds) + ((conv.session.params.pence ? parseInt(conv.session.params.pence) : 0) / 100),
      });
    } else {
      conv.add('Invalid transaction type.');
      return;
    }
    conv.add('Transaction successfully created!');
  } catch (e) {
    conv.add(`Failed to create transaction: ${e}`);
  }
});

app.handle('repeat_confirmation', (conv) => {
  conv.add(conv.session.params.confirmation_message);
});

exports.ActionsOnGoogleFulfillment = functions.https.onRequest(app);
