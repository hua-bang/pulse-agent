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

  function normalizeTodoItems(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(function (item, index) {
        if (!item || typeof item !== 'object') return null;
        var text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) return null;
        return {
          id: typeof item.id === 'string' && item.id ? item.id : 'todo-' + (index + 1),
          text: text,
          done: item.done === true,
        };
      })
      .filter(Boolean);
  }

  function nextTodoId(items) {
    var used = new Set(items.map(function (item) { return item.id; }));
    var index = items.length + 1;
    while (used.has('todo-' + index)) index += 1;
    return 'todo-' + index;
  }

  function TodoListNodeView(props) {
    const React = getReact();
    const node = props.node || {};
    const data = node.data || {};
    const payload = getPayload(data);
    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'Todo List';
    const items = normalizeTodoItems(payload.items);
    const readOnly = props.readOnly === true;
    const doneCount = items.filter(function (item) { return item.done; }).length;

    function updateItems(nextItems) {
      if (readOnly) return;
      props.updateNode({
        data: {
          ...data,
          payload: {
            ...payload,
            title: title,
            items: nextItems,
          },
        },
      });
    }

    return React.createElement(
      'div',
      {
        style: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 18,
          background: '#ffffff',
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
              color: '#0f766e',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
          },
          'mf2 remote / mock.todo-list',
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
          title,
        ),
        React.createElement(
          'div',
          {
            style: {
              marginTop: 6,
              fontSize: 12,
              color: '#667085',
            },
          },
          doneCount,
          ' of ',
          items.length,
          ' complete',
        ),
      ),
      React.createElement(
        'div',
        {
          style: {
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          },
        },
        items.length === 0
          ? React.createElement(
              'div',
              {
                style: {
                  color: '#98a2b3',
                  fontSize: 13,
                  padding: '14px 0',
                },
              },
              'No tasks yet',
            )
          : items.map(function (item) {
              return React.createElement(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  disabled: readOnly,
                  onClick: function () {
                    updateItems(items.map(function (next) {
                      return next.id === item.id
                        ? { ...next, done: !next.done }
                        : next;
                    }));
                  },
                  style: {
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '18px minmax(0, 1fr)',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: item.done ? '#f8fafc' : '#fff',
                    color: '#1f2328',
                    cursor: readOnly ? 'default' : 'pointer',
                    padding: '9px 10px',
                    textAlign: 'left',
                  },
                },
                React.createElement(
                  'span',
                  {
                    style: {
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: item.done ? '1px solid #0f766e' : '1px solid #cbd5e1',
                      background: item.done ? '#0f766e' : '#ffffff',
                      color: '#ffffff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 11,
                      lineHeight: 1,
                    },
                  },
                  item.done ? 'x' : '',
                ),
                React.createElement(
                  'span',
                  {
                    style: {
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 13,
                      textDecoration: item.done ? 'line-through' : 'none',
                      color: item.done ? '#667085' : '#1f2328',
                    },
                  },
                  item.text,
                ),
              );
            }),
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            gap: 8,
          },
        },
        React.createElement(
          'button',
          {
            type: 'button',
            disabled: readOnly,
            onClick: function () {
              updateItems([
                ...items,
                {
                  id: nextTodoId(items),
                  text: 'New task ' + (items.length + 1),
                  done: false,
                },
              ]);
            },
            style: {
              flex: 1,
              border: '1px solid rgba(15, 118, 110, 0.25)',
              borderRadius: 8,
              background: readOnly ? '#eef2f6' : '#0f766e',
              color: readOnly ? '#98a2b3' : '#ffffff',
              cursor: readOnly ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              padding: '8px 10px',
            },
          },
          'Add task',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            disabled: readOnly || doneCount === 0,
            onClick: function () {
              updateItems(items.filter(function (item) { return !item.done; }));
            },
            style: {
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: readOnly || doneCount === 0 ? '#f8fafc' : '#ffffff',
              color: readOnly || doneCount === 0 ? '#98a2b3' : '#344054',
              cursor: readOnly || doneCount === 0 ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              padding: '8px 10px',
            },
          },
          'Clear',
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
              ctx.registerNodeView('mock.todo-list', TodoListNodeView);
            },
          },
        };
      });
    },
  };
})();
