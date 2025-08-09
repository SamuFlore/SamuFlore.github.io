(function() {
  //不同的日期显示不同的样式，200 天为黄色提示，400天为红色提示，可以自己定义。
  let warningDay = 90;
  let errorDay = 365;
  // 确保能够获取到文章时间以及在文章详情页
  let times = document.getElementsByTagName('time');
  console.log(times);
  if (times.length === 0) { return; }
  let posts = document.getElementsByClassName('post-body');
  if (posts.length === 0) { return; }

  // 获取系统当前的时间
  let pubTime;
  if (times.length === 2)
  {
    pubTime = new Date(times[1].dateTime);  /* 文章更新时间戳 */
  }
  else
  {
    pubTime = new Date(times[0].dateTime);  /* 文章发布时间戳 */
  }
  let now = Date.now()  /* 当前时间戳 */
  let interval = parseInt(now - pubTime)
  let days = parseInt(interval / 86400000)
  /* 发布时间超过指定时间（毫秒） */
  //note warning 以及 note danger 是 Next 主题的自定义模板语法，如果使用其他主题，请自行更改样式以达到最佳显示效果
  if (interval > warningDay*3600*24*1000 && interval < errorDay*3600*24*1000){
    posts[0].innerHTML = '<div class="note warning">' +
      '<h5>文章时效性注意</h5><p>本文更新于 ' + days + ' 天前，已逾三月。部分信息可能发生改变，敬请留意。</p>' +
      '</div>' + posts[0].innerHTML;
    }else if(interval >= errorDay*3600*24*1000){
      posts[0].innerHTML = '<div class="note danger">' +
        '<h5>文章时效性警告</h5><p>本文更新于 ' + days + ' 天前，已逾一年。部分信息可能已发生改变，敬请留意。</p>' +
        '</div>' + posts[0].innerHTML;
    }
    else{
      posts[0].innerHTML = '<div class="note info">' + 
        '<h5>文章时效性提示</h5><p>本文更新于 ' + days + ' 天前。</p>' +
        '</div>' + posts[0].innerHTML;
    }
  })();

