/** MessagePort handshake with the shell, and posting messages back to it. */
export const portChunk = `  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index) || count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }

  function postToParent(message) {
    if (!activePortPostMessage) {
      return;
    }

    activePortPostMessage(message);
  }

  function closePortCandidate(candidate) {
    try {
      candidate.close();
    } catch (error) {}
  }

  function acceptPortCandidate(candidate) {
    if (activePortPostMessage) {
      closePortCandidate(candidate);
      return;
    }

    activePortPostMessage = candidate.post;

    pendingPortCandidates.forEach(function (pending) {
      if (pending !== candidate) {
        closePortCandidate(pending);
      }
    });
    pendingPortCandidates = [candidate];
  }

  function createPortCandidate() {
    if (
      !sessionHandshake ||
      typeof SafeMessageChannel !== 'function' ||
      !safeParentPostMessage
    ) {
      return null;
    }

    var channel = new SafeMessageChannel();
    var candidate = {
      port: channel.port1,
      remotePort: channel.port2,
      post: channel.port1.postMessage.bind(channel.port1),
      close: channel.port1.close.bind(channel.port1),
      accepted: false,
    };

    channel.port1.onmessage = function (event) {
      var data = event.data;

      if (!candidate.accepted) {
        if (
          isRecord(data) &&
          data.type === C.CONNECT_ACK &&
          data.protocolVersion === C.PROTOCOL_VERSION
        ) {
          candidate.accepted = true;
          acceptPortCandidate(candidate);
        }
        return;
      }

      handleShellMessage(data);
    };
    pendingPortCandidates.push(candidate);
    return candidate;
  }

  function connectEditorPort(candidate) {
    if (!candidate || activePortPostMessage || !safeParentPostMessage) {
      if (candidate) {
        closePortCandidate(candidate);
      }
      return;
    }

    try {
      safeParentPostMessage(
        {
          type: C.CONNECT,
          handshake: sessionHandshake,
          protocolVersion: C.PROTOCOL_VERSION,
        },
        C.PARENT_ORIGIN || '*',
        [candidate.remotePort],
      );
    } catch (error) {
      closePortCandidate(candidate);
    }
  }

  if (sessionHandshake) {
    var connectDelays = [0, 50, 200, 1000];
    var connectCandidates = connectDelays.map(function () {
      return createPortCandidate();
    });

    connectEditorPort(connectCandidates[0]);
    connectDelays.slice(1).forEach(function (delay, index) {
      safeSetTimeout(function () {
        connectEditorPort(connectCandidates[index + 1]);
      }, delay);
    });
  }

  function postError(message, code) {
    postToParent({
      type: C.ERROR,
      message: String(message),
      code: code || undefined,
    });
  }
`
