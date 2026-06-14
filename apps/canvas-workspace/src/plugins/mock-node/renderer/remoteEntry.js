(function () {
  const remoteName = 'pulse_canvas_mock_node';

  function getReact() {
    const React = globalThis.__PULSE_CANVAS_PLUGIN_REACT__;
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('[pulse_canvas_mock_node] React bridge is missing');
    }
    return React;
  }

  function getPayload(data) {
    if (data && data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)) {
      return data.payload;
    }
    return {};
  }

  function MockCardNodeView(props) {
    const React = getReact();
    const node = props.node || {};
    const data = node.data || {};
    const payload = getPayload(data);
    const text = typeof payload.text === 'string' ? payload.text : 'Plugin node';
    const count = typeof payload.count === 'number' ? payload.count : 0;
    const readOnly = props.readOnly === true;

    return React.createElement(
      'div',
      {
        style: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 14,
          padding: 18,
          background: 'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)',
          boxSizing: 'border-box',
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          {
            style: {
              fontSize: 11,
              fontWeight: 700,
              color: '#2383e2',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
          },
          'mf2 remote / mock.card',
        ),
        React.createElement(
          'div',
          {
            style: {
              marginTop: 8,
              fontSize: 18,
              lineHeight: 1.25,
              fontWeight: 700,
              color: '#1f2328',
            },
          },
          text,
        ),
        React.createElement(
          'div',
          {
            style: {
              marginTop: 8,
              fontSize: 12,
              lineHeight: 1.45,
              color: '#667085',
            },
          },
          'This node view was loaded through the Module Federation runtime.',
        ),
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          },
        },
        React.createElement(
          'div',
          {
            style: {
              minWidth: 72,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(35, 131, 226, 0.08)',
              color: '#1f2328',
              fontSize: 13,
              fontWeight: 700,
            },
          },
          'count ',
          count,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            disabled: readOnly,
            onClick: function () {
              if (readOnly) return;
              props.updateNode({
                data: {
                  ...data,
                  payload: {
                    ...payload,
                    count: count + 1,
                  },
                },
              });
            },
            style: {
              border: '1px solid rgba(35, 131, 226, 0.25)',
              borderRadius: 8,
              background: readOnly ? '#eef2f6' : '#2383e2',
              color: readOnly ? '#98a2b3' : '#fff',
              cursor: readOnly ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              padding: '8px 12px',
            },
          },
          'Increment',
        ),
      ),
    );
  }

  globalThis[remoteName] = {
    init: function () {},
    get: function (expose) {
      if (expose !== './plugin' && expose !== '.') {
        return Promise.reject(new Error('[pulse_canvas_mock_node] unknown expose: ' + expose));
      }
      return Promise.resolve(function () {
        return {
          default: {
            id: 'mock',
            activate: function (ctx) {
              ctx.registerNodeView('mock.card', MockCardNodeView);
            },
          },
        };
      });
    },
  };
})();
